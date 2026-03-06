# Grumpy Critique: Airlock Tab Bug Fix Plan

**Reviewer**: Principal Engineer (adversarial)
**Subject**: 4-bug Airlock fix — `TaskViewerProvider.ts` + `implementation.html`

---

## CRITICAL

### 1. Payload Truncation is Half a Fix — You Still Cause a Buffer Overflow on Fallback

The plan says "remove `${text}` from the payload." Good. But the plan does NOT address the inbox fallback path. When `_attemptDirectTerminalPush` fails (e.g., terminal is not local), the function falls back to writing the message *as a JSON file* to `.switchboard/inbox/<agent>/<msgId>.json`. The JSON contains `payload` as a field. If the payload is still large (because the current fix only documents removing `${text}` from one string literal), the inbox JSON blob bloats unreasonably. The *real* fix is to ensure the payload string passed to `_dispatchExecuteMessage` is **always** compact — just the instruction + path, nothing else. The plan doesn't lock this down conceptually enough: a developer reading it could still accidentally stuff `text` into the payload under a different format.

**File**: `TaskViewerProvider.ts:6269` + `TaskViewerProvider.ts:3976`

---

### 2. The Textarea "Stability" Fix is Vague to the Point of Being Unimplementable

The plan says: *"check if the airlock panel already exists. If it does, do not recreate it."* This is dangerously hand-wavy.

`renderAgentList()` is not just called on state changes. It is called: (a) on a timer every 1s if a CoderReviewer session is polling (`implementation.html:2026-2028`), (b) every time a `terminalStatuses`, `runSheets`, `sessionStatus` message arrives. The "check if it exists" approach based on `document.getElementById('airlock-textarea') !== null` will always return `true` on the second render pass — because the DOM mutation happens synchronously. The fix needs to be much more specific: either (a) **skip rebuilding `agentListWebai`** if the Airlock tab is currently active and focused, or (b) **extract the airlock panel out of `renderAgentList()` entirely** and render it once on init. The plan does not choose. This will be implemented poorly.

**File**: `implementation.html:2035-2047`, `implementation.html:2023-2033`

---

### 3. Clearing the Textarea on Success Has a Race Condition

The plan clears `_airlockTextareaValue` (the closure variable) and sets `textarea.value = ''` in response to `airlock_planSaved` or `airlock_coderSent`. But by the time this message arrives, `renderAgentList()` may have already been triggered by the state write that saving the plan causes (writing to `.switchboard/plans/features/` triggers the plan watcher → triggers `refresh()` → triggers `renderAgentList()`). If the render runs *before* the `airlock_planSaved` message arrives, the textarea is recreated from `_airlockTextareaValue`, which is still non-empty — and then `airlock_planSaved` clears a textarea element that is already detached from the DOM. Net result: the user's text is preserved even after a success.

**File**: `TaskViewerProvider.ts:6229-6231` + `implementation.html:2188` + plan watcher at `TaskViewerProvider.ts:1005`

---

## MAJOR

### 4. No Input Sanitization on `text` Before Writing to Disk

The backend receives `text` directly from the webview and writes it to disk without any validation: `fs.promises.writeFile(patchPath, text, 'utf8')`. The webview is a sandboxed iframe, but VS Code's extension trust model allows any content to be passed as a serialized string. A sufficiently malformed patch (e.g., one that escapes the `.switchboard/airlock/` directory by embedding a crafted filename server-side — not possible here since the filename is generated — but the *content* itself is unbounded). The plan does not mention any size cap on the accepted text. A 500MB paste would write 500MB to disk without feedback. Add a `MAX_AIRLOCK_TEXT_BYTES` guard in the handler before the `writeFile`.

**File**: `TaskViewerProvider.ts:6257`

---

### 5. Sending to "coder" Preferred Over "lead" Is Architecturally Backwards

The priority is: `coderAgent || leadAgent`. This means Airlock patches land on the Coder first, skipping the Lead Coder's context. The Lead Coder in this workflow is the one who *owns* the plan and is expected to drive code changes. If the Lead Coder exists and is ready, it should receive the Airlock patch, not the junior Coder. This ordering was probably copied without thinking from somewhere else. It's an anti-pattern for the Airlock's stated purpose.

**File**: `TaskViewerProvider.ts:6260-6262`

---

### 6. Button Layout Fix Ignores Overflow — Small Panel, Long Labels

The buttons currently have labels `CONVERT TO PLAN` and `SEND TO CODER`. Side-by-side in a narrow VS Code sidebar panel (~240px), these labels will overflow or wrap, making them unreadable. The plan calls for a simple `flex-direction: row` with `gap: 8px`. There is no mention of `min-width: 0`, `overflow: hidden`, `font-size` reduction, or shortening the labels. This will look broken on most default VS Code sidebar widths.

**File**: `implementation.html:2198-2230`

---

## NIT

### 7. `_airlockTextareaValue` Is a Closure Variable, Not State

Storing panel state in a function-scoped closure variable (`let _airlockTextareaValue = ''`) is fragile. If `createWebAiAirlockPanel` is ever called from a different scope or the function is refactored, this state will be lost silently. Should use a module-level `const` or be attached to the container element via a `dataset` attribute.

### 8. Plan Does Not Address the `webai-status` ID Collision Risk

The `statusLine` element is given `id="webai-status"`. If `createWebAiAirlockPanel()` is called more than once (defensive scenario, or if the guard added in bug #3 fails), there will be duplicate IDs in the DOM. `document.getElementById('webai-status')` in button callbacks will then return the *first* match, not the current one. The plan does not address ID uniqueness.

---

**Summary**: The plan correctly identifies *what* to fix. It fails to specify *how* with enough precision to avoid introducing new bugs in fixes #2 and #3. Fix #1 is partly correct but incomplete. These are not hypothetical: the race condition in #3 is a near-certainty given the watcher topology.
