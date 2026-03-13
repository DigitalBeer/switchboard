Here is the improved plan, strictly adhering to the Switchboard "How to Plan" standard from your guidelines.

***

# Add complete all button to code reviewed kanban column

## Goal
Add a "COMPLETE ALL" button to the "Code Reviewed" column header in the Kanban board to allow users to quickly batch-archive all finished tasks with a single click.

## User Review Required
> [!NOTE]
> Adding this button replaces the invisible placeholder in the "Code Reviewed" column's auto-move bar, making it visible and interactive.
> [!WARNING]
> Because this action permanently archives multiple plans and removes them from the active workspace, a native confirmation dialog will be required to prevent accidental clicks.

## Complexity Audit
### Band A — Routine
- **UI Additions:** Replacing the invisible placeholder in the `CODE REVIEWED` column's `.auto-move-bar` with a visible right-aligned button in `src/webview/kanban.html`.
- **Event Handling:** Adding a click listener that prompts for confirmation, gathers all `sessionId`s in that column, applies optimistic CSS animations, and dispatches a new `completeAllInColumn` IPC message.
### Band B — Complex / Risky
- **State Update:** Modifying `src/services/KanbanProvider.ts` to receive the array of `sessionIds` and sequentially trigger the existing archival command to ensure safe file-locking and state reconciliation.

## Edge-Case Audit
- **Race Conditions:** Batch-completing 5+ plans simultaneously could cause file contention if `TaskViewerProvider` attempts to update the `.switchboard/plan_tombstones.json` registry for all of them at the exact same millisecond. The backend must iterate and `await` each completion command sequentially to rely on existing safe-write paths.
- **Security:** None.
- **Side Effects:** Calling `switchboard.completePlanFromKanban` multiple times in a loop will trigger `_refreshRunSheets()` multiple times. The existing 200-300ms debounce timers in the provider and watchers will safely coalesce the UI refreshes, but optimistic UI (fading the cards out instantly) is necessary so the user isn't waiting on a frozen screen.

## Adversarial Synthesis
### Grumpy Critique
If you trigger `completeAllInColumn` from the frontend, it iterates over all cards and sends them to the backend to complete. But what if a card gets manually completed by another process right before this happens? Your backend will try to complete a plan that doesn't exist anymore and might throw an uncaught error! And applying an optimistic fade-out CSS class on the frontend assumes the backend will always succeed. If the backend fails, the user is left with invisible cards that are still technically in the column!

### Balanced Response
Grumpy's point about stale state is a classic race condition in webviews. The `_handleCompletePlan` method in the backend safely catches errors and aborts if a file isn't found, preventing a hard crash. As for the optimistic UI, it is a deliberate trade-off for perceived performance. However, because `TaskViewerProvider` forces a full Kanban board refresh upon completion (even if it's debounced), the UI will automatically self-correct and re-render the accurate state from disk shortly after the batch operation finishes, rescuing any cards that failed to process.

## Proposed Changes

### `src/webview/kanban.html`
#### [MODIFY] `src/webview/kanban.html`
- **Context:** The `CODE REVIEWED` column currently has an empty `<div class="auto-move-bar">` placeholder.
- **Logic:** Add the `COMPLETE ALL` button to this bar using the standard `.auto-move-right` flex wrapper. Add an event listener for this button that:
  1. Checks if there are any cards in the column. If not, return early.
  2. Triggers `window.confirm`.
  3. Finds all `.kanban-card` elements inside `#col-CODE REVIEWED`.
  4. Adds the `.card-completing` class to each for an optimistic fade-out.
  5. Maps the `dataset.session` values to an array and posts a `completeAllInColumn` message.
- **Implementation:** See Appendix.
- **Edge Cases Handled:** Prevents empty submissions and requires explicit user confirmation.

### `src/services/KanbanProvider.ts`
#### [MODIFY] `src/services/KanbanProvider.ts`
- **Context:** The provider needs to intercept the new `completeAllInColumn` message.
- **Logic:** Add a new `case 'completeAllInColumn':` in `_handleMessage`.
- **Implementation:** Iterate over `msg.sessionIds` and sequentially `await vscode.commands.executeCommand('switchboard.completePlanFromKanban', id);`.
- **Edge Cases Handled:** Safe iteration prevents parallel write collisions in the archival engine.

## Verification Plan
### Automated Tests
- Run `npm run compile` to verify TypeScript syntax compiles successfully.

### Manual Testing
1. Open the Switchboard Kanban board.
2. Ensure there are multiple completed plans in the "Code Reviewed" column.
3. Click the "COMPLETE ALL" button in the column header.
4. Verify a confirmation dialog appears. Click "Cancel" and verify nothing happens.
5. Click the button again and select "OK".
6. Verify all cards in the column immediately begin their fade-out animation.
7. Verify the backend successfully archives all files and the cards are permanently removed from the active board and sidebar dropdown.

## Appendix: Implementation Patch
```diff
--- src/webview/kanban.html
+++ src/webview/kanban.html
@@ -... +... @@
 <div class="kanban-column" data-column="CODE REVIEWED">
 <div class="column-header">
 <div style="display:flex; flex-direction:column;">
 <span class="column-name">Code Reviewed</span>
 <div class="column-agent" id="agent-CODE REVIEWED"></div>
 </div>
 <span class="column-count" id="count-CODE REVIEWED">0</span>
 </div>
 
-<div class="auto-move-bar">
-<!-- Blank section for alignment -->
-</div>
+<div class="auto-move-bar" id="automove-bar-CODE REVIEWED">
+<div class="auto-move-left"><span class="auto-move-label">&nbsp;</span></div>
+<div class="auto-move-right">
+<button class="auto-move-btn" id="btn-complete-all">COMPLETE ALL</button>
+</div>
+</div>
 
 <div class="column-body" id="col-CODE REVIEWED"></div>
 </div>
 </div>
 
@@ -... +... @@
 document.getElementById('btn-add-plan').addEventListener('click', () => {
     vscode.postMessage({ type: 'createPlan' });
 });
 
+const btnCompleteAll = document.getElementById('btn-complete-all');
+if (btnCompleteAll) {
+    btnCompleteAll.addEventListener('click', () => {
+        const colBody = document.getElementById('col-CODE REVIEWED');
+        if (!colBody) return;
+        const cards = colBody.querySelectorAll('.kanban-card');
+        if (cards.length === 0) return;
+
+        if (!confirm(`Are you sure you want to complete and archive all ${cards.length} plan(s) in this column?`)) {
+            return;
+        }
+
+        const sessionIds = [];
+        cards.forEach(card => {
+            card.classList.add('card-completing');
+            sessionIds.push(card.dataset.session);
+        });
+
+        setTimeout(() => {
+            vscode.postMessage({ type: 'completeAllInColumn', sessionIds });
+        }, 350);
+    });
+}
+
 const codedTargetSelect = document.getElementById('coded-target-select');
 if (codedTargetSelect) {
--- src/services/KanbanProvider.ts
+++ src/services/KanbanProvider.ts
@@ -... +... @@
             case 'completePlan':
                 if (msg.sessionId) {
                     // Delegate to the sidebar's completePlan handler via internal method
                     await vscode.commands.executeCommand('switchboard.completePlanFromKanban', msg.sessionId);
                 }
                 break;
+            case 'completeAllInColumn':
+                if (Array.isArray(msg.sessionIds)) {
+                    for (const id of msg.sessionIds) {
+                        await vscode.commands.executeCommand('switchboard.completePlanFromKanban', id);
+                    }
+                }
+                break;
             case 'viewPlan':
                 if (msg.sessionId) {
                     await vscode.commands.executeCommand('switchboard.viewPlanFromKanban', msg.sessionId);
                 }
                 break;
```