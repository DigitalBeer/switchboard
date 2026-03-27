# Link card select to sidebar dropdown

## Goal
Establish a real-time link between the Kanban board and the sidebar (TaskViewer). When a user clicks a card on the Kanban board to select it, the sidebar's plan dropdown should automatically update to focus on that same session. This ensures the user has immediate access to sidebar-specific controls (like individual agent triggers or archiving) for the plan they are looking at on the board.

## Metadata
**Tags:** UI, frontend, backend
**Complexity:** High

## User Review Required
> [!NOTE]
> This feature introduces a cross-provider dependency. `KanbanProvider` will send a VS Code command that `TaskViewerProvider` handles, leveraging the existing `selectSession` message infrastructure already used internally. No new webview message types are needed on the sidebar side.

> [!IMPORTANT]
> **Decision point:** When multiple cards are selected (shift-click), the sidebar dropdown supports only a single active session. This plan follows the "most recent single click" rule — only unmodified clicks (no shift/meta/ctrl) trigger the sidebar sync. Batch selections are intentionally excluded.

## Complexity Audit
### Routine
- Adding a `postKanbanMessage({ type: 'selectPlan', sessionId })` call inside the existing card click handler in `src/webview/kanban.html` (line 1355), guarded by `!e.shiftKey && !e.metaKey && !e.ctrlKey`.
- Adding a `case 'selectPlan'` in `KanbanProvider.ts` `_handleMessage` that calls an existing VS Code command.
### Complex / Risky
- **Cross-provider communication architecture**: `KanbanProvider` currently has no reference to `TaskViewerProvider`. However, `TaskViewerProvider` already sets itself as `_kanbanProvider` (line 643–646). The reverse dependency (KanbanProvider → TaskViewerProvider) can be established either via (a) a symmetric setter on `KanbanProvider`, (b) a VS Code command, or (c) having `TaskViewerProvider` register a command that `KanbanProvider` invokes. Option (b) — using `vscode.commands.executeCommand` — is the cleanest approach because `TaskViewerProvider` already handles the `selectSession` message internally (used at lines 4273, 5321, 5436) and we can register a command for external callers.
- **Sidebar not visible**: If the sidebar webview is not initialized (`this._view` is undefined), `postMessage` will silently fail. `TaskViewerProvider` already handles this safely via optional chaining (`this._view?.webview.postMessage(...)` throughout the codebase). The `_lastSessionId` will still be updated so when the sidebar is next opened, it can pick up the correct session.

## Edge-Case & Dependency Audit
- **Race Conditions:** Card click → `postKanbanMessage` → extension host → `TaskViewerProvider` is asynchronous but serialised through the VS Code message channel. No concurrent writes to `_lastSessionId` can occur from this path since cards always require user clicks.
- **Security:** The session ID is passed from the webview as a string. It's already validated as a string comparison against existing session data in `TaskViewerProvider`.
- **Side Effects:** The sidebar dropdown will change selection on card click. Users who have manually selected a different session in the sidebar might be surprised by this. However, this is the explicitly requested behaviour. The reverse direction (sidebar → Kanban) is documented as a future consideration and is out of scope.
- **Dependencies & Conflicts:** Plan 1 ("Tooltips") and Plan 2 ("Re-plan button") both modify `src/webview/kanban.html` but in different regions. Plan 3 modifies the card click handler at lines 1355–1365, which is in the `renderBoard()` function — separate from the column button area (Plan 2) and CSS/createCardHtml (Plan 1). No conflict.

## Adversarial Synthesis
### Grumpy Critique
"Every time someone clicks a card, you're firing a message across the webview bridge to the extension host, which then fires *another* command to the sidebar provider, which then fires *another* `postMessage` to the sidebar webview. That's three async hops for a click event. And what if the user is rapidly clicking through cards? You'll spam the sidebar with selection events. There's no debounce, no throttle, nothing. And you're adding a VS Code command registration just for this — that's a permanent global command polluting the command palette. Also, what about the first click on a card that *deselects* it? Your guard checks for `!e.shiftKey` but doesn't check whether the click actually resulted in a *selection* vs a *deselection*. If I click a selected card to deselect it, you'll still fire `selectPlan` with that session ID even though it's no longer selected."

### Balanced Response
The three-hop path is architecturally correct — webview → extension host → provider → sidebar is the standard VS Code cross-webview communication pattern, used throughout the codebase for all Kanban actions. The cost per hop is negligible (sub-millisecond in-process message passing). However, the deselection concern is valid: we should only fire `selectPlan` when the card is being *selected*, not deselected. The implementation will check `selectedCards.has(sid) === false` (pre-toggle state, meaning it's about to be selected) before sending the message. Rapid clicking is not a practical concern since each click is a discrete user action, but for correctness we could add a simple "last-sent" dedup. The VS Code command approach can be replaced by having `TaskViewerProvider` expose a public method and `KanbanProvider` call it via a stored reference — avoiding command palette pollution.

**Clarification (implied by existing architecture):** Instead of registering a new VS Code command, `KanbanProvider` should store a reference to `TaskViewerProvider` via a setter method (mirroring how `TaskViewerProvider` stores `_kanbanProvider` at line 165). `TaskViewerProvider` already uses `this._view?.webview.postMessage({ type: 'selectSession', sessionId })` at lines 4273, 5321, and 5436, so a new public method `selectSession(sessionId: string)` on `TaskViewerProvider` is the natural API surface.

## Proposed Changes

> [!IMPORTANT]
> **MAXIMUM DETAIL REQUIRED:** Complete code blocks with exact search/replace targeting.

### [Backend] Add TaskViewerProvider Reference to KanbanProvider
#### [MODIFY] `src/services/KanbanProvider.ts`

**Change 1: Import TaskViewerProvider type (top of file)**

- **Context:** `KanbanProvider` needs to hold a reference to `TaskViewerProvider` to call its `selectSession` method.
- **Logic:** Add an import statement. `TaskViewerProvider` is already imported in some files; check if already imported and add if not.
- **Implementation:** Search for existing imports at the top of `KanbanProvider.ts`. If `TaskViewerProvider` is not already imported:

```typescript
import { TaskViewerProvider } from './TaskViewerProvider';
```

**Change 2: Add a private field and setter method**

- **Context:** `KanbanProvider` needs a stored reference to `TaskViewerProvider`, matching the symmetric pattern where `TaskViewerProvider` stores `_kanbanProvider` (line 165 of `TaskViewerProvider.ts`).
- **Logic:** Add a private field `_taskViewerProvider?: TaskViewerProvider` and a public setter `setTaskViewerProvider(provider: TaskViewerProvider)`.
- **Implementation:** Add near the existing private fields in the class:

```typescript
private _taskViewerProvider?: TaskViewerProvider;

public setTaskViewerProvider(provider: TaskViewerProvider) {
    this._taskViewerProvider = provider;
}
```

**Change 3: Add `selectPlan` case to `_handleMessage` (inside the switch block, after line 1993)**

- **Context:** When the webview sends a `selectPlan` message, the backend should route the selection to the sidebar.
- **Logic:** Extract `sessionId` from the message, validate it, and call `_taskViewerProvider.selectSession(sessionId)` if the reference is available.
- **Implementation:**

```typescript
case 'selectPlan': {
    const { sessionId } = msg;
    if (typeof sessionId === 'string' && sessionId.trim() && this._taskViewerProvider) {
        this._taskViewerProvider.selectSession(sessionId);
    }
    break;
}
```

- **Edge Cases Handled:** If `_taskViewerProvider` is not set (extension startup race), the message is silently ignored. If `sessionId` is empty or non-string, no action is taken.

---

### [Backend] Add `selectSession` Public Method to TaskViewerProvider
#### [MODIFY] `src/services/TaskViewerProvider.ts`

**Change 1: Add public `selectSession` method**

- **Context:** `TaskViewerProvider` already posts `{ type: 'selectSession', sessionId }` messages in multiple places (lines 4273, 5321, 5436). A public method encapsulates this for external callers.
- **Logic:** Update `_lastSessionId` so the sidebar state persists even if the webview is not visible, then post the message to the webview if available.
- **Implementation:** Add this method to the class (e.g., after the existing `setKanbanProvider` method at line 646):

```typescript
/**
 * Programmatically select a session in the sidebar dropdown.
 * Called by KanbanProvider when the user clicks a card on the Kanban board.
 */
public selectSession(sessionId: string) {
    this._lastSessionId = sessionId;
    this._view?.webview.postMessage({ type: 'selectSession', sessionId });
}
```

- **Edge Cases Handled:** If the sidebar webview is not visible (`this._view` is undefined), the `postMessage` is skipped via optional chaining, but `_lastSessionId` is still updated so the correct session is selected when the sidebar is next opened.

---

### [Extension] Wire the References
#### [MODIFY] `src/extension.ts`

**Change 1: Call `kanbanProvider.setTaskViewerProvider(taskViewerProvider)` during activation**

- **Context:** In the extension's `activate()` function, `TaskViewerProvider` and `KanbanProvider` are both instantiated. The existing call `taskViewerProvider.setKanbanProvider(kanbanProvider)` at the wiring point must be complemented with the reverse reference.
- **Logic:** After the existing `taskViewerProvider.setKanbanProvider(kanbanProvider)` call, add `kanbanProvider.setTaskViewerProvider(taskViewerProvider)`.
- **Implementation:**

```typescript
// Existing line:
taskViewerProvider.setKanbanProvider(kanbanProvider);
// Add immediately after:
kanbanProvider.setTaskViewerProvider(taskViewerProvider);
```

---

### [Webview] Notify on Card Selection
#### [MODIFY] `src/webview/kanban.html`

**Change 1: Add `selectPlan` message in the card click handler (lines 1354–1365)**

- **Context:** The card click handler at line 1355 manages selection toggle state. After selecting a card (not deselecting), we should notify the extension to sync the sidebar.
- **Logic:** Inside the click handler, after the `selectedCards.add(sid)` path (the "selecting" branch), send a `selectPlan` message with the session ID. Only fire on unmodified clicks (no shift/meta/ctrl) to avoid spamming during batch selections.
- **Implementation:**

```diff
                // Card selection toggle (click on card body, not on buttons)
                el.addEventListener('click', (e) => {
                    if (e.target.closest('.card-btn') || e.target.closest('button')) return;
                    const sid = el.dataset.session;
                    if (selectedCards.has(sid)) {
                        selectedCards.delete(sid);
                        el.classList.remove('selected');
                    } else {
                        selectedCards.add(sid);
                        el.classList.add('selected');
+                       // Sync sidebar dropdown to this card on unmodified single clicks
+                       if (!e.shiftKey && !e.metaKey && !e.ctrlKey) {
+                           postKanbanMessage({ type: 'selectPlan', sessionId: sid });
+                       }
                    }
                });
```

- **Edge Cases Handled:**
  - **Deselection:** The `selectPlan` message is only sent in the `else` branch (when a card is being *selected*), not when it's being deselected.
  - **Batch selection:** Shift/meta/ctrl clicks are excluded via the modifier key guard, preventing sidebar spam during multi-select operations.
  - **Button clicks:** The existing guard `if (e.target.closest('.card-btn') || e.target.closest('button')) return;` at line 1356 ensures button clicks (Copy, Pair, Review, Complete) don't trigger card selection or sidebar sync.

## Verification Plan
### Manual Verification
1. Open both the Kanban board and the Switchboard Sidebar simultaneously.
2. Click a card on the Kanban board (single, unmodified click on the card body, not on a button).
3. Verify the plan dropdown in the sidebar immediately changes to match the clicked card's session.
4. Click a different card. Verify the sidebar follows.
5. Click the same card again to deselect it. Verify the sidebar does **not** change (it should remain on the previously selected session).
6. Shift-click multiple cards. Verify the sidebar does **not** change during batch selection.
7. Close the sidebar, click a card, then reopen the sidebar. Verify it opens with the most recently clicked card selected.
8. If the sidebar is not initialized (first launch), click a card, then open the sidebar. Verify no errors in the console.

### Agent Recommendation
**Send to Lead Coder** — this involves cross-provider wiring across three files (`extension.ts`, `KanbanProvider.ts`, `TaskViewerProvider.ts`) plus a webview modification, with architectural decisions about the communication pattern.
