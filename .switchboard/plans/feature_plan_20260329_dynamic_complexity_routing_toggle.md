# Feature Plan: Dynamic Complexity Routing Toggle in Planned Column

## Goal
Add a toggle button in the "PLAN REVIEWED" kanban column that controls dynamic complexity routing. When enabled (default), the system routes tasks based on complexity (low → coder, high → lead). When disabled, all tasks go to the lead coder regardless of complexity.

## Metadata
**Tags:** frontend, backend, UI
**Complexity:** Low

## User Review Required
> [!NOTE]
> This feature adds a new toggle control in the PLAN REVIEWED column. Default behavior (toggle ON) maintains current complexity-based routing. No breaking changes.

## Rationale
When using Copilot in the lead coder slot, it costs as much to send it all the little tasks it does with subagents as it would to just send it the high complexity task. Often users want to have all tasks included in the lead coder prompt, bypassing the complexity-based routing logic.

## Complexity Audit
### Routine
- Add boolean state property to `KanbanProvider.ts` with workspace state persistence
- Add getter method for state property
- Add message handler for toggle state changes
- Send state to webview on panel refresh
- Add state variable and update function in `kanban.html`
- Add HTML toggle element in PLAN REVIEWED column header
- Add event listener for toggle changes
- Add message handler in webview for state updates
- Reuse existing CSS classes (`.toggle-label`, `.is-off`) for styling

### Complex / Risky
- Modify `_generateBatchExecutionPrompt()` routing logic to conditionally check complexity based on toggle state
- **Clarification:** When toggle is OFF, force `hasHighComplexity = true` to route all tasks to 'lead' role
- **Decision Point:** Whether to apply toggle logic to `batchLowComplexity` (line ~1529) and `julesLowComplexity` (line ~1552) filters or keep them independent

## Current Behavior
- The `_generateBatchExecutionPrompt()` method in `KanbanProvider.ts` (line ~659) checks complexity:
  - `hasHighComplexity = cards.some(card => !this._isLowComplexity(card))`
  - If any card is high complexity → routes to 'lead' role
  - If all cards are low complexity → routes to 'coder' role
- Low complexity cards in PLAN REVIEWED are filtered for Jules dispatch and batch coding prompts

## Proposed Changes
> [!IMPORTANT]
> **MAXIMUM DETAIL REQUIRED:** Complete implementation with exact line numbers, full code blocks, and step-by-step logic.

### Backend State Management
#### MODIFY `src/services/KanbanProvider.ts`

**Context:** The `KanbanProvider` class manages kanban board state and routing logic. We need to add a new boolean state property to control whether complexity-based routing is enabled.

**Logic:**
1. Add a private boolean property `_dynamicComplexityRoutingEnabled` to store the toggle state
2. Initialize it in the constructor from workspace state (defaults to `true` for backward compatibility)
3. Add a public getter for external access (though currently unused, maintains consistency with `cliTriggersEnabled` pattern)

**Implementation:**

Add the private property after line 61 (after `_cliTriggersEnabled`):
```typescript
private _dynamicComplexityRoutingEnabled: boolean;
```

In the constructor, after line 78 (after `_cliTriggersEnabled` initialization), add:
```typescript
this._dynamicComplexityRoutingEnabled = this._context.workspaceState.get<boolean>(
    'kanban.dynamicComplexityRoutingEnabled',
    true  // default: enabled to maintain current behavior
);
```

Add the getter after line 84 (after the `cliTriggersEnabled` getter):
```typescript
public get dynamicComplexityRoutingEnabled(): boolean {
    return this._dynamicComplexityRoutingEnabled;
}
```

**Edge Cases Handled:**
- Default value `true` ensures backward compatibility for existing users
- Workspace state (not global) allows per-workspace configuration

### Message Handler for Toggle State
#### MODIFY `src/services/KanbanProvider.ts`

**Context:** The webview sends messages to the backend when users interact with UI controls. We need to handle the toggle state change message.

**Logic:**
1. Add a new case in the message handler switch statement
2. Update the in-memory state from the message
3. Persist the state to workspace storage
4. Use `!!` to ensure boolean coercion (defensive programming)

**Implementation:**

In the `_handleWebviewMessage()` method, after the `toggleCliTriggers` case (line ~1394), add:
```typescript
case 'toggleDynamicComplexityRouting':
    this._dynamicComplexityRoutingEnabled = !!msg.enabled;
    try {
        await this._context.workspaceState.update(
            'kanban.dynamicComplexityRoutingEnabled',
            this._dynamicComplexityRoutingEnabled
        );
    } catch (err) {
        console.error('[KanbanProvider] Failed to persist dynamicComplexityRoutingEnabled:', err);
        // State remains in-memory; non-critical failure
    }
    break;
```

**Edge Cases Handled:**
- `!!msg.enabled` coerces to boolean, handling undefined/null/truthy values
- Try-catch ensures persistence failures don't crash the handler
- In-memory state is updated even if persistence fails, maintaining UI consistency for the current session

### Send State to Webview on Refresh
#### MODIFY `src/services/KanbanProvider.ts`

**Context:** When the kanban panel is opened or refreshed, the backend sends the current state to the webview so the UI can display the correct toggle position.

**Logic:**
1. In the `refreshWithData()` method, after sending `cliTriggersState` (line ~266), send the dynamic complexity routing state
2. This ensures the webview always has the current state when it initializes or refreshes

**Implementation:**

In the `refreshWithData()` method, after line 266 (after `cliTriggersState` message), add:
```typescript
this._panel.webview.postMessage({
    type: 'dynamicComplexityRoutingState',
    enabled: this._dynamicComplexityRoutingEnabled
});
```

**Edge Cases Handled:**
- Message is sent after `updateBoard` and `cliTriggersState`, ensuring webview is ready
- Boolean value is sent directly (no serialization issues)

### Update Batch Execution Routing Logic
#### MODIFY `src/services/KanbanProvider.ts`

**Context:** The `_generateBatchExecutionPrompt()` method (line ~659) determines whether to route cards to 'lead' or 'coder' based on complexity. We need to make this conditional on the toggle state.

**Logic:**
1. When toggle is ON (enabled): Check if any card has high complexity (current behavior)
2. When toggle is OFF (disabled): Force `hasHighComplexity = true` to always route to 'lead'
3. The ternary operator provides a clean, readable implementation
4. **Decision:** The `batchLowComplexity` (line ~1529) and `julesLowComplexity` (line ~1552) actions will NOT respect this toggle. They continue to filter for low-complexity cards as designed. This maintains their specialized purpose while allowing the general batch prompt to be overridden.

**Implementation:**

Replace line 660 in `_generateBatchExecutionPrompt()` method:

**OLD:**
```typescript
const hasHighComplexity = cards.some(card => !this._isLowComplexity(card));
```

**NEW:**
```typescript
const hasHighComplexity = this._dynamicComplexityRoutingEnabled
    ? cards.some(card => !this._isLowComplexity(card))
    : true;  // When disabled, treat all as high complexity → route to lead
```

The rest of the method remains unchanged:
```typescript
const role = hasHighComplexity ? 'lead' : 'coder';
const instruction = hasHighComplexity ? undefined : 'low-complexity';
const pairProgrammingEnabled = this._autobanState?.pairProgrammingEnabled ?? false;
const aggressivePairProgramming = this._autobanState?.aggressivePairProgramming ?? false;
return buildKanbanBatchPrompt(role, this._cardsToPromptPlans(cards, workspaceRoot), {
    instruction,
    pairProgrammingEnabled,
    aggressivePairProgramming
});
```

**Edge Cases Handled:**
- When toggle is OFF, `hasHighComplexity` is always `true`, forcing `role = 'lead'` and `instruction = undefined`
- When toggle is ON, behavior is identical to current implementation
- The `batchLowComplexity` and `julesLowComplexity` actions are intentionally NOT modified, maintaining their specialized filtering behavior

### Frontend State Management
#### MODIFY `src/webview/kanban.html`

**Context:** The webview needs to track the toggle state and update the UI accordingly.

**Logic:**
1. Add a module-level state variable to track the toggle state (defaults to `true` matching backend)
2. Add an update function to sync the UI with the state
3. Follow the same pattern as `updateCliToggleUi()` for consistency

**Implementation:**

After line 1081 (after `cliTriggersEnabled` declaration), add:
```javascript
let dynamicComplexityRoutingEnabled = true;
```

After line 1145 (after `updateCliToggleUi()` function), add:
```javascript
function updateComplexityRoutingToggleUi() {
    const toggle = document.getElementById('complexity-routing-toggle');
    const toggleLabel = document.getElementById('complexity-routing-label');
    if (toggle) {
        toggle.checked = !!dynamicComplexityRoutingEnabled;
    }
    if (toggleLabel) {
        toggleLabel.classList.toggle('is-off', !dynamicComplexityRoutingEnabled);
    }
}
```

**Edge Cases Handled:**
- Null checks prevent errors if DOM elements don't exist yet
- `!!` coercion ensures boolean value
- `.toggle('is-off', condition)` safely adds/removes class based on state

### Add Toggle HTML to PLAN REVIEWED Column
#### MODIFY `src/webview/kanban.html`

**Context:** The toggle needs to appear in the PLAN REVIEWED column header, next to the mode toggle (CLI/Prompt switch).

**Logic:**
1. Check if current column is 'PLAN REVIEWED'
2. If yes, generate the toggle HTML; otherwise, empty string
3. Insert the toggle into the `rightSide` div between `modeToggle` and the column count
4. Use existing CSS classes for consistent styling
5. Tooltip explains the toggle behavior clearly

**Implementation:**

In the `renderColumns()` function, after line 1264 (after `modeToggle` definition), add:
```javascript
const isPlanReviewed = def.id === 'PLAN REVIEWED';
const complexityRoutingToggle = isPlanReviewed
    ? `<label id="complexity-routing-label" class="cli-toggle-inline" data-tooltip="Dynamic routing: ON = route by complexity (low→coder, high→lead), OFF = all batch prompts to lead. Low-complexity buttons unaffected.">
           <label class="toggle-switch">
               <input type="checkbox" id="complexity-routing-toggle" checked>
               <span class="toggle-slider"></span>
           </label>
           <span class="toggle-label">Dynamic Routing</span>
       </label>`
    : '';
```

Then modify the `rightSide` definition (line ~1272) to include the toggle:
```javascript
const rightSide = isCreated
    ? `<div style="display: flex; align-items: center; gap: 8px; line-height: 1;">
            <button class="btn-add-plan" id="btn-add-plan" data-tooltip="Add Plan">+</button>
            <button class="btn-add-plan" id="btn-import-clipboard" data-tooltip="Import plan from clipboard"><img src="${ICON_IMPORT_CLIPBOARD}" alt="Import" style="width: 16px; height: 16px;"></button>
            <span class="column-count" id="count-${escapeAttr(def.id)}">0</span>
       </div>`
    : `<div style="display: flex; align-items: center; gap: 4px;">
            ${modeToggle}
            ${complexityRoutingToggle}
            <span class="column-count" id="count-${escapeAttr(def.id)}">0</span>
       </div>`;
```

**Edge Cases Handled:**
- Toggle only appears in PLAN REVIEWED column (conditional rendering)
- Uses existing `.cli-toggle-inline` and `.toggle-switch` classes for consistent styling
- Tooltip clearly explains behavior and clarifies that low-complexity buttons are unaffected
- Default `checked` attribute ensures initial state matches backend default

### Add Event Listener for Toggle Changes
#### MODIFY `src/webview/kanban.html`

**Context:** When the user clicks the toggle, we need to update the local state, refresh the UI, and notify the backend.

**Logic:**
1. Listen for 'change' events on the toggle checkbox
2. Extract the checked state with defensive `!!` coercion
3. Update the local state variable
4. Call the UI update function to sync visual state
5. Send a message to the backend to persist the change

**Implementation:**

After line 2196 (after the CLI triggers toggle listener), add:
```javascript
document.getElementById('complexity-routing-toggle')?.addEventListener('change', (event) => {
    const checked = !!event.target?.checked;
    dynamicComplexityRoutingEnabled = checked;
    updateComplexityRoutingToggleUi();
    postKanbanMessage({ type: 'toggleDynamicComplexityRouting', enabled: checked });
});
```

**Edge Cases Handled:**
- Optional chaining (`?.`) prevents errors if element doesn't exist
- `!!event.target?.checked` safely coerces to boolean
- UI update happens before backend message to provide immediate visual feedback

### Add Message Handler for State Updates
#### MODIFY `src/webview/kanban.html`

**Context:** When the backend sends the initial state or a state update, the webview needs to update its local state and UI.

**Logic:**
1. Add a new case in the message handler switch
2. Update the local state variable from the message
3. Call the UI update function to sync the toggle visual state
4. Use `!== false` to default to `true` if undefined (defensive programming)

**Implementation:**

In the message handler, after the `cliTriggersState` case (line ~2029), add:
```javascript
case 'dynamicComplexityRoutingState':
    dynamicComplexityRoutingEnabled = msg.enabled !== false;
    updateComplexityRoutingToggleUi();
    break;
```

**Edge Cases Handled:**
- `msg.enabled !== false` defaults to `true` if `msg.enabled` is undefined, matching backend default
- UI update ensures toggle visual state matches received state

### CSS Styling
#### NO CHANGES REQUIRED to `src/webview/kanban.html`

**Context:** The webview already has CSS classes for toggle styling.

**Logic:** Reuse existing `.cli-toggle-inline`, `.toggle-switch`, `.toggle-slider`, `.toggle-label`, and `.is-off` classes that are already defined for the CLI triggers toggle and pair programming toggle. This ensures visual consistency across all toggles.

**Implementation:** No new CSS required. The HTML uses:
- `.cli-toggle-inline` (line ~852): Inline flex layout for toggle + label
- `.toggle-switch` (defined in existing CSS): Toggle switch container
- `.toggle-slider` (defined in existing CSS): Visual slider element
- `.toggle-label` (line ~964): Label text styling
- `.is-off` (line ~866): Orange color when toggle is OFF

**Edge Cases Handled:** Consistent styling with existing toggles ensures users immediately understand the UI pattern.

## Verification Plan
### Automated Tests
- **Existing Tests:** No existing tests directly cover `_generateBatchExecutionPrompt()` routing logic. Manual testing required.
- **New Tests Recommended:** Add unit tests for `_generateBatchExecutionPrompt()` to verify:
  - When toggle is ON and all cards are low complexity → routes to 'coder'
  - When toggle is ON and any card is high complexity → routes to 'lead'
  - When toggle is OFF and all cards are low complexity → routes to 'lead'
  - When toggle is OFF and any card is high complexity → routes to 'lead'

### Manual Testing Checklist
- [ ] Toggle appears in PLAN REVIEWED column header (not in other columns)
- [ ] Toggle defaults to ON (checked) on first load
- [ ] Toggle state persists across kanban panel close/reopen
- [ ] When ON: Low complexity cards route to coder, high complexity to lead (current behavior)
- [ ] When OFF: All batch execution prompts route to lead regardless of complexity
- [ ] Toggle state syncs correctly between backend and frontend
- [ ] Visual styling matches CLI triggers toggle and pair programming toggle
- [ ] Tooltip displays helpful description with clarification about low-complexity buttons
- [ ] "Batch Low Complexity" button continues to filter for low-complexity cards (unaffected by toggle)
- [ ] "Jules Low Complexity" button continues to filter for low-complexity cards (unaffected by toggle)
- [ ] Toggling OFF then clicking "Copy Prompt" on mixed-complexity selection routes to lead
- [ ] Toggling ON then clicking "Copy Prompt" on low-complexity-only selection routes to coder

## Files to Modify

1. `/Users/patrickvuleta/Documents/GitHub/switchboard/src/services/KanbanProvider.ts`
   - Add state property and getter
   - Initialize in constructor
   - Add message handler
   - Send state to webview
   - Update `_generateBatchExecutionPrompt()` logic

2. `/Users/patrickvuleta/Documents/GitHub/switchboard/src/webview/kanban.html`
   - Add state variable
   - Add update function
   - Modify PLAN REVIEWED column header HTML
   - Add event listener
   - Add message handler

## Edge-Case & Dependency Audit
- **Race Conditions:** None. Toggle state changes are synchronous and immediately persisted to workspace state. No concurrent state mutations.
- **Security:** None. Toggle only affects internal routing logic; no external API calls or user input validation required.
- **Side Effects:** When toggle is disabled, all batch execution prompts route to 'lead' role regardless of card complexity. This affects `_generateBatchExecutionPrompt()` but may not affect `batchLowComplexity` and `julesLowComplexity` actions (decision needed).
- **Backward Compatibility:** Default to `true` (enabled) to maintain current behavior for existing users.
- **State Persistence:** Uses workspace state (not global) so each workspace can have different settings.
- **Dependencies & Conflicts:** No conflicts detected with other pending Kanban plans. This is an isolated UI/routing feature.

## Adversarial Synthesis
### Grumpy Critique
🔥 **"This is half-baked routing chaos waiting to happen!"** 🔥

Let me tell you what's wrong with this plan:

1. **Inconsistent Behavior:** You're modifying `_generateBatchExecutionPrompt()` but completely ignoring the `batchLowComplexity` and `julesLowComplexity` actions! When the toggle is OFF and a user clicks "Batch Low Complexity" or "Jules Low Complexity", what happens? Do those buttons still filter for low complexity cards only, or do they respect the toggle? You've created a UX nightmare where the toggle says "send everything to lead" but the low-complexity buttons still exist and do... what exactly?

2. **Missing Error Handling:** What happens if `workspaceState.update()` fails? You're not catching errors or notifying the user. The toggle could appear to work in the UI but silently fail to persist.

3. **Tooltip Ambiguity:** Your tooltip says "Toggle dynamic complexity routing (on: route by complexity, off: all to lead)" but it doesn't explain what happens to the low-complexity batch buttons. Users will be confused.

4. **No Visual Feedback:** When the toggle is OFF, there's no visual indication on the low-complexity buttons that they might behave differently or be disabled. The UI lies to the user.

5. **Incomplete Specification:** You say "Consider updating other complexity-based filters" but then don't make a decision! This is a plan, not a suggestion box. Make the call: either those filters respect the toggle or they don't. Document it.

6. **State Sync Risk:** You're sending `dynamicComplexityRoutingState` to the webview after `cliTriggersState` (line ~266), but what if the webview hasn't finished initializing? What if the message arrives before the DOM is ready? You need to ensure the toggle element exists before trying to update it.

7. **Testing Gaps:** Your testing checklist doesn't verify the interaction between the toggle and the low-complexity batch/Jules buttons. It doesn't test what happens when you toggle OFF, then click "Batch Low Complexity". Does it send 0 cards? All cards? Only low cards to lead?

### Balanced Response
Grumpy raises valid concerns about consistency and completeness. Here's how the implementation addresses them:

1. **Routing Consistency Decision:** The toggle will ONLY affect `_generateBatchExecutionPrompt()`, which is called by the general "Copy Prompt" actions. The `batchLowComplexity` and `julesLowComplexity` actions will continue to filter for low-complexity cards as they do today. This is intentional: when the toggle is OFF, users can still use the specialized low-complexity buttons if they want, but the general batch prompt will route everything to lead. We'll add a note in the tooltip to clarify this.

2. **Error Handling:** We'll wrap the `workspaceState.update()` call in a try-catch and log errors. Since this is a non-critical UI preference, we won't show error messages to users, but we'll ensure the in-memory state stays consistent.

3. **Tooltip Clarity:** Updated tooltip: "Dynamic routing: ON = route by complexity (low→coder, high→lead), OFF = all batch prompts to lead. Low-complexity buttons unaffected."

4. **Visual Feedback:** The low-complexity buttons remain unchanged because they continue to work as before. The toggle only affects the general batch prompt generation, not the specialized buttons.

5. **Specification Completeness:** Decision made (see #1). The plan now explicitly states which methods are affected and which are not.

6. **State Sync:** The webview message handler for `dynamicComplexityRoutingState` already includes a null check (`if (toggle)`), so it safely handles cases where the DOM isn't ready. We'll also call `updateComplexityRoutingToggleUi()` during initialization.

7. **Testing Enhancement:** Added test cases for toggle interaction with low-complexity buttons to verify they continue to work independently.

## Success Criteria

- Users can disable dynamic complexity routing to send all tasks to lead coder
- Toggle is easily discoverable in the PLAN REVIEWED column
- State persists correctly across sessions
- No breaking changes to existing complexity routing when toggle is ON

## Reviewer Pass — 2025-07-18

### Summary of Findings

#### Stage 1 — Grumpy Principal Engineer Critique (see main response for full text)
- **CRITICAL**: `_resolveComplexityRoutedRole` (line ~1164) did not check `_dynamicComplexityRoutingEnabled`. All card *movement* paths (`moveSelected`, `moveAll`, drag-and-drop, MCP moves) via `_partitionByComplexityRoute` ignored the toggle. When toggle OFF, low-complexity cards still routed to CODER CODED instead of LEAD CODED. Only the clipboard prompt text was affected.
- **MAJOR**: `batchLowComplexity` handler (line ~1567) called `_generateBatchExecutionPrompt` without override. When toggle OFF, the forced `hasHighComplexity = true` produced a lead prompt for cards the user explicitly selected as low-complexity. Plan stated these buttons should be "independent" of the toggle.
- **NIT**: Checkbox hardcoded to `checked` in HTML template (line ~1282). Brief UI flash if persisted state is `false`. Same pattern as CLI triggers toggle — consistent.
- **NIT**: Error handling asymmetry — `toggleCliTriggers` has no try/catch, `toggleDynamicComplexityRouting` does. The plan specified try/catch, so this is actually a pattern improvement.

#### Stage 2 — Balanced Synthesis
- **Keep**: State management (property, constructor, getter, workspace persistence), webview message flow, UI toggle HTML, event listeners — all correct and follow existing patterns.
- **Fixed now (CRITICAL)**: Added early-return in `_resolveComplexityRoutedRole` — when `_dynamicComplexityRoutingEnabled` is false, returns `'lead'` immediately, bypassing all complexity checks. This propagates through ALL card movement paths.
- **Fixed now (MAJOR)**: Added `overrideRole?: 'lead' | 'coder'` parameter to `_generateBatchExecutionPrompt`. `batchLowComplexity` now passes `'coder'`, ensuring low-complexity buttons always generate coder prompts regardless of toggle.
- **Deferred (NITs)**: Checkbox `checked` attribute and error handling asymmetry — both are trivial and consistent with existing patterns.

### Files Changed
1. **`src/services/KanbanProvider.ts`**
   - `_resolveComplexityRoutedRole` (line ~1164): Added toggle guard — `if (!this._dynamicComplexityRoutingEnabled) return 'lead';`
   - `_generateBatchExecutionPrompt` (line ~655): Added optional `overrideRole` parameter to allow callers to bypass toggle logic
   - `batchLowComplexity` handler (line ~1578): Passes `'coder'` override to `_generateBatchExecutionPrompt`

### Validation Results
- `npx tsc --noEmit` — **PASS** (zero errors)
- No changes to `kanban.html` (frontend was correct)

### Remaining Risks
- The `julesLowComplexity` handler (line ~1586) does NOT use `_generateBatchExecutionPrompt` — it dispatches via `triggerAgentFromKanban` with role `'jules'`. No toggle interaction; no fix needed.
- When toggle is OFF and autoban dispatches from PLAN REVIEWED, `_partitionByComplexityRoute` now routes everything to `lead` group → all cards go to LEAD CODED. This is the intended behavior per the plan goal but should be validated with end-to-end testing.
- No automated tests exist for the toggle feature. Manual testing recommended for: toggle ON/OFF persistence across reload, drag-drop routing, batch prompt clipboard content, MCP move routing.
