# Add Visual Feedback to "OPEN AGENT TERMINALS" Button

## Goal
The "OPEN AGENT TERMINALS" button in the sidebar (`implementation.html`, line 1341) currently fires a `createAgentGrid` postMessage and provides zero visual feedback to the user. The button should follow the same 3-state feedback pattern (dispatching → success/error → reset) already used by agent action buttons, giving the user immediate confirmation that the action was received and whether it succeeded.

## User Review Required
- Confirm that **"OPENING..."**, **"TERMINALS OPENED"**, and **"FAILED"** are acceptable label strings (matching the terse style of the existing "DISPATCHING..." / "DISPATCHED" / "FAILED" pattern).
- Confirm that the 2-second reset timer is appropriate for this button (same as agent action buttons).

## Complexity Audit

**Manual Complexity Override:** Low


### Routine
| # | Item | Rationale |
|---|------|-----------|
| 1 | Add `dispatching` class + text swap in the click handler | Single-line JS additions mirroring an established pattern. No new APIs. |
| 2 | Add CSS animation rules for `.secondary-btn.success` and `.secondary-btn.error` | The existing `.secondary-btn.success` (line 793) and `.secondary-btn.error` (line 798) rules set color/border only — they lack the `animation` property. Adding `animation: success-glow 1.2s ease-out, sweep 1s ease-out;` and `animation: error-shake 0.4s ease-out;` respectively reuses the `@keyframes` already defined at lines 1012–1052. |
| 3 | Handle `createAgentGridResult` message in webview `message` listener | Follows the exact pattern of `actionTriggered` handler (lines 2286–2323). |
| 4 | Wrap backend handler in try/catch and postMessage result | The `case 'createAgentGrid'` handler (TaskViewerProvider.ts line 2940) currently awaits the command with no response. Wrapping in try/catch and calling `this._view?.webview.postMessage(...)` follows the `restorePlanResult` / `copyPlanLinkResult` pattern used elsewhere in the same file. |

### Complex / Risky
- None.


## Edge-Case & Dependency Audit
1. **Rapid double-click**: Button is disabled during dispatching, so a second click is a no-op. Covered by disabling in the click handler.
2. **Backend never responds**: A 30-second client-side timeout resets the button to its default state and logs a warning to the console.
3. **Webview disposed mid-operation**: The `this._view?.webview.postMessage(...)` call uses optional chaining — if the webview is gone, the call silently no-ops. No crash risk.
4. **Multiple webview panels**: Only one sidebar webview instance exists for `TaskViewerProvider`. No fan-out concern.
5. **CSS class collision with "RESET ALL AGENTS"**: The `.feedback` qualifier on animation rules ensures only transient feedback states animate. The static `error` class on "RESET ALL AGENTS" is unaffected.
6. **`createAgentGrid` called from Command Palette**: The command palette path (`switchboard.createAgentGrid`) invokes `createAgentGrid()` directly, bypassing the webview message handler. No webview button exists in that flow, so no feedback is expected or needed. The new `postMessage` in TaskViewerProvider is only reached via the webview message path.
7. **No visible agents configured**: `createAgentGrid()` handles this gracefully (empty agent list → no terminals created → success message still fires). The button will show "TERMINALS OPENED" which is correct — the operation completed, even if the result was zero terminals.

## Adversarial Synthesis

### Grumpy Critique
Oh WONDERFUL. Another "just add a CSS class" ticket that somehow requires touching three files across two layers of the stack. Let me get this straight — we have a button that *works perfectly fine*, and now we're threading a `postMessage` round-trip through the extension host, through a command dispatcher, back through the provider, back through the webview bridge, just so a button can turn green for TWO SECONDS?

And I see we're adding animations to `.secondary-btn.success` and `.secondary-btn.error` — classes that are ALREADY IN USE on the "RESET ALL AGENTS" button. So now we need a `.feedback` guard class to stop the reset button from doing a little shimmy every time the panel renders. We're literally adding complexity to prevent the side effects of our own complexity.

The 30-second timeout is cute. If the backend takes 30 seconds to open some terminals, the user has bigger problems than button feedback. And let's talk about that `finally { sendLoadingState(false) }` — you're trusting a *different* code path to clean up state for your *new* code path. When that loading state refactors next quarter, your button silently breaks.

At least the change is self-contained. I'll give you that. But if this "simple UI feedback" ticket takes more than 45 minutes of coder time, I'm filing a process incident.

### Balanced Response
The grumpy concerns are valid but manageable:

1. **Three-file touch is necessary**: The webview ↔ provider ↔ extension boundary is an architectural reality of VS Code extensions. There is no shortcut — the feedback loop *requires* a backend response. The alternative (optimistic "success" with no confirmation) would be misleading when terminal creation fails.

2. **`.feedback` guard class**: This is a one-line addition that cleanly separates static styling from transient animation state. It's a standard CSS pattern and adds negligible complexity. The alternative — using entirely different class names like `.success-animated` — is arguably worse because it duplicates color/border rules.

3. **30-second timeout**: This is a safety net, not a primary path. The normal round-trip is 2–5 seconds. The timeout prevents a permanently stuck button if something truly unexpected happens (extension host crash, message lost). It's defensive programming, not over-engineering.

4. **`sendLoadingState` coupling**: The new `createAgentGridResult` message is independent of `sendLoadingState`. The button resets on its *own* result message, not on the loading state. The two mechanisms are orthogonal. If `sendLoadingState` is refactored, the button feedback is unaffected.

5. **Scope**: The change is self-contained, touches no shared abstractions, and follows established patterns verbatim. Risk is low.

## Proposed Changes

### Frontend — Webview HTML/JS/CSS
#### [MODIFY] `src/webview/implementation.html`

- **Context:** The "OPEN AGENT TERMINALS" button (`id="createAgentGrid"`, line 1341) currently has a one-line click handler (lines 1780–1781) that fires a `postMessage` with no visual feedback. The webview `message` event listener (starting ~line 2100) handles incoming messages from the backend but has no handler for a `createAgentGridResult` message type.
- **Logic:**
  1. **CSS (lines 793–801):** Add `animation` properties to `.secondary-btn.success` and `.secondary-btn.error`, but only when a `.feedback` class is also present, to avoid animating static uses of these classes (e.g., "RESET ALL AGENTS" button).
  2. **Click handler (lines 1780–1781):** Replace the one-line handler with a multi-line handler that:
     - Stores the original button text (`'OPEN AGENT TERMINALS'`)
     - Sets `btn.innerText = 'OPENING...'`
     - Adds `'dispatching'` class, removes `'is-teal'` class temporarily
     - Sets `btn.disabled = true`
     - Calls `vscode.postMessage({ type: 'createAgentGrid' })`
     - Starts a 30-second safety timeout that resets the button if no result arrives
  3. **Message handler (~line 2100+ in the `window.addEventListener('message', ...)` block):** Add a `case 'createAgentGridResult'` handler that:
     - Clears the safety timeout
     - Removes `'dispatching'` class
     - If `message.success`: adds `'success'` and `'feedback'` classes, sets text to `'TERMINALS OPENED'`
     - If `!message.success`: adds `'error'` and `'feedback'` classes, sets text to `'FAILED'`
     - After 2000 ms: resets text to `'OPEN AGENT TERMINALS'`, removes `'success'`, `'error'`, `'feedback'` classes, re-adds `'is-teal'`, re-enables button
- **Implementation:**
  ```css
  /* Add after existing .secondary-btn.success rule (line 796) */
  .secondary-btn.success.feedback {
      animation: success-glow 1.2s ease-out, sweep 1s ease-out;
      background: linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--accent-green) 60%, transparent) 50%, transparent 100%);
      background-size: 200% 100%;
  }

  /* Add after existing .secondary-btn.error rule (line 801) */
  .secondary-btn.error.feedback {
      animation: error-shake 0.4s ease-out;
  }
  ```

  ```javascript
  // Replace lines 1780-1781 click handler:
  const btnGrid = document.getElementById('createAgentGrid');
  if (btnGrid) {
      let gridResultTimeout = null;
      btnGrid.addEventListener('click', () => {
          btnGrid.innerText = 'OPENING...';
          btnGrid.classList.add('dispatching');
          btnGrid.classList.remove('is-teal');
          btnGrid.disabled = true;
          vscode.postMessage({ type: 'createAgentGrid' });
          if (gridResultTimeout) clearTimeout(gridResultTimeout);
          gridResultTimeout = setTimeout(() => {
              // Safety reset if backend never responds
              btnGrid.innerText = 'OPEN AGENT TERMINALS';
              btnGrid.classList.remove('dispatching', 'success', 'error', 'feedback');
              btnGrid.classList.add('is-teal');
              btnGrid.disabled = false;
              gridResultTimeout = null;
          }, 30000);
      });

      // Expose timeout handle for the message handler
      window._gridResultTimeout = null;
      btnGrid._gridResultTimeout = null;
  }
  ```

  ```javascript
  // Add in the message event listener switch block:
  case 'createAgentGridResult': {
      const gridBtn = document.getElementById('createAgentGrid');
      if (gridBtn) {
          if (gridBtn._gridResultTimeout) {
              clearTimeout(gridBtn._gridResultTimeout);
              gridBtn._gridResultTimeout = null;
          }
          gridBtn.classList.remove('dispatching');
          if (message.success) {
              gridBtn.classList.add('success', 'feedback');
              gridBtn.innerText = 'TERMINALS OPENED';
          } else {
              gridBtn.classList.add('error', 'feedback');
              gridBtn.innerText = 'FAILED';
          }
          setTimeout(() => {
              gridBtn.innerText = 'OPEN AGENT TERMINALS';
              gridBtn.classList.remove('success', 'error', 'feedback');
              gridBtn.classList.add('is-teal');
              gridBtn.disabled = false;
          }, 2000);
      }
      break;
  }
  ```
- **Edge Cases Handled:**
  - Rapid double-click: button is disabled during dispatching.
  - Backend timeout: 30-second safety net resets the button.
  - Static `.error` class on "RESET ALL AGENTS": `.feedback` qualifier prevents animation on that button.

### Backend — TaskViewerProvider
#### [MODIFY] `src/services/TaskViewerProvider.ts`

- **Context:** The `case 'createAgentGrid'` handler (lines 2940–2942) currently awaits the VS Code command and sends no response to the webview. The webview has no way to know whether the operation succeeded or failed.
- **Logic:** Wrap the `executeCommand` call in a try/catch block and send a `createAgentGridResult` message back to the webview with `success: true` or `success: false`.
- **Implementation:**
  ```typescript
  // Replace lines 2940-2942:
  case 'createAgentGrid':
      try {
          await vscode.commands.executeCommand('switchboard.createAgentGrid');
          this._view?.webview.postMessage({ type: 'createAgentGridResult', success: true });
      } catch (e) {
          this._view?.webview.postMessage({ type: 'createAgentGridResult', success: false });
      }
      break;
  ```
- **Edge Cases Handled:**
  - Command throws: caught and reported as `success: false`.
  - Webview disposed before response: optional chaining (`this._view?.webview`) prevents crash.
  - Command Palette invocation: this code path is only reached via webview postMessage, not from the Command Palette registration, so no duplicate messages.

## Verification Plan

### Automated Tests
- **Build verification:** Run `npm run compile` (or the project's build command) to confirm no TypeScript errors are introduced by the TaskViewerProvider.ts change.
- **Lint verification:** Run the project linter to confirm no style violations in the modified files.
- No unit tests currently exist for webview feedback behavior; adding them is out of scope for this change.

### Manual Tests
1. **Happy path — success feedback:**
   - Open the Switchboard sidebar.
   - Click "OPEN AGENT TERMINALS".
   - **Expect:** Button immediately shows "OPENING..." with reduced opacity and wait cursor. After terminals are created (2–15 s), button shows "TERMINALS OPENED" with green border and sweep animation. After 2 s, button resets to "OPEN AGENT TERMINALS" with original teal styling.
2. **Idempotent re-click:**
   - With terminals already open, click "OPEN AGENT TERMINALS" again.
   - **Expect:** Same feedback cycle — "OPENING..." → "TERMINALS OPENED" → reset. Existing terminals are reused, not duplicated.
3. **Rapid double-click:**
   - Click the button twice quickly.
   - **Expect:** Second click is ignored (button is disabled). Only one feedback cycle occurs.
4. **Error path:**
   - Simulate a failure (e.g., temporarily break the `createAgentGrid` command registration).
   - Click the button.
   - **Expect:** Button shows "OPENING...", then "FAILED" with red border and shake animation, then resets after 2 s.
5. **"RESET ALL AGENTS" button unaffected:**
   - After the change, verify that the "RESET ALL AGENTS" button does not shake or animate on panel load. It should retain its static red border styling.
6. **Command Palette path unaffected:**
   - Open the Command Palette and run "Switchboard: Create Agent Grid" (or equivalent).
   - **Expect:** Terminals open normally. No webview errors in the developer console.

## Recommendation
**Send to Coder** — This is a straightforward 3-file change following an established pattern. All modifications are mechanical (add CSS rules, expand a click handler, wrap a backend handler in try/catch). No architectural decisions or ambiguity remain.

## Reviewer Pass

**Date:** 2025-07-18
**Reviewer:** Copilot (automated code review)

### Findings

| ID | Severity | Description | Verdict |
|:---|:---|:---|:---|
| CRITICAL-1 | CRITICAL | `.secondary-btn.success.feedback` (line 793) referenced `@keyframes success-glow` which does not exist. Only `pulse-green`, `sweep`, and `error-shake` are defined. The success glow animation was silently absent. | **Fixed** — replaced `success-glow` → `pulse-green` |
| NIT-1 | NIT | Plan edge-case prose says "logs a warning to the console" for the 30s timeout, but neither the plan's code snippet nor the implementation includes a `console.warn`. | **Dismissed** — silent reset is acceptable; plan code is consistent |

### Pre-existing Issue (out of scope, noted for awareness)

The same `success-glow` reference exists in `.action-btn.success` (lines 1066, 1069) — a pre-existing bug predating this feature. Not fixed here per review scope rules. Recommend a follow-up to replace those references with `pulse-green` as well.

### Files Changed

| File | Change |
|:---|:---|
| `src/webview/implementation.html` | Line 793: `success-glow` → `pulse-green` in `.secondary-btn.success.feedback` animation |

### Implementation Conformance

All six plan requirements verified as implemented:

1. ✅ CSS: `.secondary-btn.success.feedback` and `.secondary-btn.error.feedback` with `.feedback` qualifier
2. ✅ JS click handler: disable, "OPENING...", dispatching class, `is-teal` removal, 30s safety timeout
3. ✅ JS message handler: `case 'createAgentGridResult'` with success/error classes, 2s reset
4. ✅ Backend: try/catch wrapper on `case 'createAgentGrid'` in TaskViewerProvider.ts, `postMessage` result
5. ✅ Double-click protection: `btn.disabled = true` during dispatching
6. ✅ RESET ALL AGENTS unaffected: button has `error` class but no `feedback`, so animations don't fire

### Verification

- `npm run compile` — **passed** (webpack compiled successfully, 0 errors)

### Remaining Risks

- **Low:** Pre-existing `success-glow` bug in `.action-btn.success` (lines 1066, 1069) means agent action buttons also have a broken glow. Separate fix recommended.
- **None:** No other risks identified for this feature.
