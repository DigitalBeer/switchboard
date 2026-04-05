# Refactor Onboarding State Synchronization

## Goal
Replace the duplicate message workaround in the onboarding flow with a proper state machine that ensures the UI only transitions after all required data is loaded. This eliminates the race condition and message duplication introduced by the bugfix in `feature_plan_20260401_072646_terminal_startup_commands_not_saved_during_bootstrapping.md`.

## Metadata
**Tags:** refactor, frontend, backend, architecture  
**Complexity:** Medium  
**Related Plans:** feature_plan_20260401_072646_terminal_startup_commands_not_saved_during_bootstrapping.md

## User Review Required
> [!NOTE]
> This is an architectural refactor that changes the onboarding flow's message passing pattern. It consolidates multiple messages into a single atomic "onboarding complete + initial data" message, eliminating race conditions and duplicate requests.

## Complexity Audit
### Routine
- Modify backend `_handleFinishOnboarding` to send a single consolidated message
- Update frontend `toggleOnboarding` to wait for data before transitioning UI
- Remove the duplicate `getStartupCommands` and `getVisibleAgents` calls added in the bugfix

### Complex / Risky
- **State machine coordination:** The frontend must handle the transition from onboarding to main UI as an atomic operation with loading states
- **Backward compatibility:** Existing users who reload during the transition must not see broken UI
- **Message ordering:** The consolidated message must include all data (setupStatus, startupCommands, visibleAgents, planIngestionFolder) in a single payload

## Problem Statement

### Current Architecture (Post-Bugfix)
```
Backend: finishOnboarding()
  ├─> sends setupStatus: false
  ├─> calls refresh()
  │    ├─> sends startupCommands
  │    └─> sends visibleAgents
  
Frontend: receives setupStatus
  ├─> transitions UI immediately
  ├─> sends getStartupCommands (duplicate!)
  └─> sends getVisibleAgents (duplicate!)
```

**Issues:**
1. Four messages in flight for data that could be sent once
2. Race condition: UI transitions before backend's `refresh()` messages arrive
3. No synchronization primitive or acknowledgment pattern
4. Duplicate requests are safe (idempotent handlers) but inelegant

### Desired Architecture
```
Backend: finishOnboarding()
  └─> sends onboardingComplete {
       setupStatus: false,
       startupCommands: {...},
       visibleAgents: {...},
       planIngestionFolder: "..."
     }

Frontend: receives onboardingComplete
  ├─> populates all UI state atomically
  └─> transitions UI (no race condition)
```

**Benefits:**
1. Single message with all required data
2. Atomic state transition (no race condition)
3. No duplicate requests
4. Clear contract: "onboarding complete" means "all data included"

## Proposed Changes

### Backend: Consolidate Onboarding Completion Message

#### MODIFY `src/services/TaskViewerProvider.ts`

**Location:** `_handleFinishOnboarding` method (around line 8715-8723)

**Current implementation:**
```typescript
case 'finishOnboarding':
    this._needsSetup = false;
    await this.saveState();
    this._view?.webview.postMessage({ type: 'setupStatus', needsSetup: false });
    this.refresh();
    break;
```

**Proposed implementation:**
```typescript
case 'finishOnboarding': {
    this._needsSetup = false;
    await this.saveState();
    
    // Gather all initial state data
    const startupCommands = await this.getStartupCommands();
    const planIngestionFolder = await this.getPlanIngestionFolder();
    const visibleAgents = await this.getVisibleAgents();
    
    // Send consolidated onboarding complete message
    this._view?.webview.postMessage({
        type: 'onboardingComplete',
        setupStatus: false,
        startupCommands,
        planIngestionFolder,
        visibleAgents
    });
    
    // Still call refresh() to update other UI elements (agent grid, etc.)
    // but the critical startup data is already sent above
    this.refresh();
    break;
}
```

**Rationale:**
- The `onboardingComplete` message includes all data needed to populate the Terminal Operations section
- The `refresh()` call remains to update other UI elements (agent grid, kanban state, etc.)
- The frontend can now transition atomically after receiving this single message

### Frontend: Atomic State Transition

#### MODIFY `src/webview/implementation.html`

**Location 1:** Add new message handler for `onboardingComplete` (around line 2750, after the `visibleAgents` handler)

```javascript
case 'onboardingComplete':
    // This message signals that onboarding is complete AND includes all initial state
    if (message.setupStatus === false) {
        // Populate startup commands
        if (message.startupCommands) {
            lastStartupCommands = message.startupCommands;
            lastPlanIngestionFolder = message.planIngestionFolder || '';
            document.querySelectorAll('input[type="text"][data-role]').forEach(input => {
                input.value = message.startupCommands[input.dataset.role] || '';
            });
            const planIngestionFolderInput = document.getElementById('plan-ingestion-folder-input');
            if (planIngestionFolderInput) {
                planIngestionFolderInput.value = lastPlanIngestionFolder;
            }
        }
        
        // Populate visible agents
        if (message.visibleAgents) {
            lastVisibleAgents = { ...lastVisibleAgents, ...message.visibleAgents };
            document.querySelectorAll('.agent-visible-toggle').forEach(cb => {
                const role = cb.dataset.role;
                if (role && role in lastVisibleAgents) cb.checked = lastVisibleAgents[role];
            });
        }
        
        // NOW transition the UI (data is already populated)
        toggleOnboarding(false);
    }
    break;
```

**Location 2:** Update `toggleOnboarding` function (around line 4143-4150)

**Current implementation (with bugfix):**
```javascript
} else {
    _setupComplete = true;
    onboardingContainer.classList.add('hidden');
    mainContainer.classList.remove('hidden');
    // Request saved state to populate Terminal Operations section
    vscode.postMessage({ type: 'getStartupCommands' });
    vscode.postMessage({ type: 'getVisibleAgents' });
}
```

**Proposed implementation:**
```javascript
} else {
    _setupComplete = true;
    onboardingContainer.classList.add('hidden');
    mainContainer.classList.remove('hidden');
    // Data is already populated by the onboardingComplete handler
    // No need to request it again
}
```

**Rationale:**
- The `onboardingComplete` handler populates all state BEFORE calling `toggleOnboarding(false)`
- The UI transition happens only after data is ready
- No race condition, no duplicate requests

### Backward Compatibility

**Scenario:** User reloads VS Code while the extension is already set up (not in onboarding)

**Current behavior:** The `initialState` message handler (around line 2615-2650) sends `getStartupCommands` and `getVisibleAgents` requests when `needsSetup` is false.

**Required change:** None. The existing `initialState` handler already handles this case correctly. The refactor only affects the onboarding completion flow.

## Edge-Case & Dependency Audit

### Edge Cases
1. **User clicks "SKIP" during onboarding:**
   - Backend sends `onboardingComplete` with empty `startupCommands` and default `visibleAgents`
   - Frontend populates UI with empty values (no crash)
   
2. **User reloads during onboarding:**
   - The `initialState` handler detects `needsSetup: true` and shows onboarding UI
   - No change from current behavior
   
3. **Backend fails to load startup commands:**
   - The `getStartupCommands()` method returns `{}` on error
   - Frontend receives empty object and leaves fields blank (graceful degradation)

### Dependencies
- **No breaking changes:** The existing `setupStatus`, `startupCommands`, and `visibleAgents` message handlers remain for backward compatibility
- **No conflicts:** This refactor is independent of other pending plans
- **Test updates required:** The `onboarding-regression.test.js` test must be updated to expect the new `onboardingComplete` message

## Verification Plan

### Automated Tests

#### UPDATE `src/test/onboarding-regression.test.js`

**Changes required:**
1. Update line 49 to send `onboardingComplete` instead of `setupStatus`
2. Include `startupCommands` and `visibleAgents` in the message payload
3. Verify that the UI is populated BEFORE the transition (not after)
4. Fix the element selector at line 86 to use `querySelector('input[data-role="lead"]')` instead of `getElementById('role-cli-lead')`

**Example:**
```javascript
// Simulate onboarding complete with consolidated message
const testCommands = { lead: 'test-lead-cmd', coder: 'test-coder-cmd' };
const testAgents = { lead: true, coder: true, reviewer: false };
window.postMessage({
    type: 'onboardingComplete',
    setupStatus: false,
    startupCommands: testCommands,
    visibleAgents: testAgents,
    planIngestionFolder: '/test/path'
}, '*');
await new Promise(resolve => setTimeout(resolve, 50));

// Verify UI is populated AND transitioned
const leadInput = window.document.querySelector('input[data-role="lead"]');
assert.strictEqual(leadInput.value, 'test-lead-cmd', 'Lead CLI input should be updated');
assert.ok(onboardingContainer.classList.contains('hidden'), 'Onboarding should be hidden');
assert.ok(!mainContainer.classList.contains('hidden'), 'Main container should be visible');
```

### Manual Testing

1. **Fresh onboarding flow:**
   - Delete `.switchboard/state.json`
   - Enter CLI commands in onboarding form
   - Click "SAVE & FINISH"
   - **Expected:** Main UI appears with fields already populated (no flicker, no delay)
   
2. **Existing user (already onboarded):**
   - Reload extension with existing `.switchboard/state.json`
   - **Expected:** Main UI appears immediately with saved values (no change from current behavior)
   
3. **Skip onboarding:**
   - Delete `.switchboard/state.json`
   - Click "SKIP"
   - **Expected:** Main UI appears with empty fields (no crash)

### Success Criteria
- ✅ Single `onboardingComplete` message sent (no duplicate `getStartupCommands`/`getVisibleAgents`)
- ✅ UI transitions only after data is populated (no race condition)
- ✅ No console errors or warnings
- ✅ Backward compatibility maintained for existing users
- ✅ All tests pass (including updated `onboarding-regression.test.js`)

## Implementation Checklist
- [ ] Modify `TaskViewerProvider.ts` `_handleFinishOnboarding` method
- [ ] Add `onboardingComplete` message handler in `implementation.html`
- [ ] Remove duplicate `postMessage` calls from `toggleOnboarding`
- [ ] Update `onboarding-regression.test.js` to test new message flow
- [ ] Fix test element selector (`data-role` instead of `id`)
- [ ] Run `npm run compile` and verify no TypeScript errors
- [ ] Run `npm test` and verify all tests pass
- [ ] Manual testing: fresh onboarding, existing user, skip onboarding
- [ ] Update original bugfix plan to reference this refactor

## Technical Debt Removed
- Eliminates duplicate message requests (4 messages → 1 message)
- Removes race condition between `setupStatus` and `refresh()` messages
- Establishes clear contract: "onboarding complete" includes all required data
- Improves testability: single message to mock instead of multiple async messages
