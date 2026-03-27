# Re-plan button

## Goal
Repurpose the existing 'Analyst Map' column button (which currently triggers `analystMapSelected`) in the 'Planned' (PLAN REVIEWED) column to function as a 'Re-plan' button. This button should trigger the `improve-plan` workflow for the selected cards, sending their planning context back to the planner agent for high-reasoning refinement.

## Metadata
**Tags:** backend, UI, frontend
**Complexity:** Low

## User Review Required
> [!IMPORTANT]
> This change **replaces** the `analystMapSelected` functionality with a `rePlanSelected` action. The existing Analyst Map feature will no longer be accessible from the Kanban board. If the analyst map column button is still needed, it should be preserved as a separate button or moved elsewhere before this plan is executed.
>
> The `analystMapSelected` handler in `KanbanProvider.ts` (lines 1970–1993) will become dead code after the webview change. It should be removed.
>
> The `improve-plan` instruction is intentionally passed verbatim — the planner agent should treat the existing plan as a draft to interrogate, not as sacred. It may restructure or replace any section.

## Complexity Audit
### Routine
- Changing `data-action="analystMapSelected"` to `data-action="rePlanSelected"` in the column header button generation in `src/webview/kanban.html` (line 1109).
- Updating the `data-tooltip` text and `alt` text on the same button (line 1109–1110).
- Changing the visibility guard from `lastVisibleAgents.analyst` to `lastVisibleAgents.planner` (line 1108) — semantic correctness.
- Adding `'rePlanSelected'` to the no-next-column guard on line 1176.
- Replacing `case 'analystMapSelected'` with `case 'rePlanSelected'` in the webview click switch (line 1214).
- Replacing `case 'analystMapSelected'` with `case 'rePlanSelected'` in `KanbanProvider.ts` (line 1970). Backend handler is a direct copy of the `julesSelected` pattern — `triggerBatchAgentFromKanban` with role `'planner'` and instruction `'improve-plan'`. This exact call already exists at 5 sites in the file.
- Removing dead code: the `analystMapSelected` handler block (lines 1970–1993 of `KanbanProvider.ts`).
### Complex / Risky
- None.

## Edge-Case & Dependency Audit
- **Race Conditions:** If the user triggers 'Re-plan' on a card that is already in active processing by another agent, the `triggerBatchAgentFromKanban` command checks the terminal dispatch state. Switchboard's terminal dispatch system prevents multiple concurrent dispatches to the same terminal, so this is handled by the existing infrastructure.
- **Security:** No new security concerns — the `rePlanSelected` handler validates `sessionIds` is a non-empty array and `workspaceRoot` is resolved before dispatching.
- **Side Effects:** The Analyst Map feature will no longer be accessible from the Kanban board after this change. Any users relying on this feature will lose access.
- **Dependencies & Conflicts:** Plan 1 ("Tooltips are still broken") also modifies `src/webview/kanban.html` but in different regions (CSS comment at line 770, card buttons at line 1446). No conflict. There is an existing Kanban card "Kanban Card Buttons Missing Tooltip Attributes" (`sess_1774494170986`) in the CODE REVIEWED column that overlaps with Plan 1 but not this plan.

## Adversarial Synthesis
### Grumpy Critique
"So you're hijacking an icon that means 'Analyst Map' and repurposing it to mean 'Re-plan'. That's lazy UX — the icon now means something completely different. And you're checking `lastVisibleAgents.analyst` to decide whether to show a *planner* button? That's a semantic bug waiting to happen: if someone disables the analyst but has a planner configured, the re-plan button vanishes for no reason. Also, what happens to the `analystMapSelected` dead code in `KanbanProvider.ts`? If you don't remove it, the next developer will be very confused about what 'analystMapSelected' does when nothing in the UI triggers it. And your guard on line 1176 — you're adding `rePlanSelected` to the whitelist, but did you check that the _new_ case handler actually reads `column` from the button? The `analystMapSelected` handler ignores `column` entirely, but your `rePlanSelected` handler needs `workspaceRoot` which comes from `msg.workspaceRoot` — and the webview click handler for column icon buttons doesn't include `workspaceRoot` in the message. Where does it come from?"

### Balanced Response
The icon reuse is per user's explicit request. The visibility guard will be fixed to check `lastVisibleAgents.planner` instead of `lastVisibleAgents.analyst`. The dead code for `analystMapSelected` in `KanbanProvider.ts` will be removed. Regarding `workspaceRoot`: the existing `analystMapSelected` handler at `KanbanProvider.ts` line 1971 calls `this._resolveWorkspaceRoot(msg.workspaceRoot)` — and the webview handler at line 1217 sends `{ type: 'analystMapSelected', sessionIds: ids }` without `workspaceRoot`. The `_resolveWorkspaceRoot()` method (line 240 of `TaskViewerProvider.ts`, similar implementation in `KanbanProvider.ts`) falls back to the active workspace root when `workspaceRoot` is undefined, so this is safe. However, for robustness, the new webview handler should include `workspaceRoot: getActiveWorkspaceRoot()` in the message. The `column` value is available from `btn.dataset.column`, though the re-plan handler doesn't need it since it's always PLAN REVIEWED by the visibility guard.

## Proposed Changes

> [!IMPORTANT]
> **MAXIMUM DETAIL REQUIRED:** Complete code blocks with exact search/replace targeting.

### [Webview] Repurpose Analyst Map Button to Re-plan
#### [MODIFY] `src/webview/kanban.html`

**Change 1: Rename button action and update tooltip (lines 1108–1111)**

- **Context:** The `analystMapBtn` is conditionally rendered for the PLAN REVIEWED column. It needs to become a re-plan button targeting the planner agent instead of the analyst.
- **Logic:** Change `data-action` from `analystMapSelected` to `rePlanSelected`. Change the visibility guard from `lastVisibleAgents.analyst` to `lastVisibleAgents.planner`. Update tooltip and alt text. Keep the same icon (`ICON_ANALYST_MAP`) per user's request.
- **Implementation:**

```diff
-                    const analystMapBtn = (isPlanReviewed && lastVisibleAgents.analyst !== false)
-                        ? `<button class="column-icon-btn" data-action="analystMapSelected" data-column="${escapeAttr(def.id)}" data-tooltip="Generate context map for selected plans">
-                               <img src="${ICON_ANALYST_MAP}" alt="Analyst Map">
-                           </button>`
-                        : '';
+                    const rePlanBtn = (isPlanReviewed && lastVisibleAgents.planner !== false)
+                        ? `<button class="column-icon-btn" data-action="rePlanSelected" data-column="${escapeAttr(def.id)}" data-tooltip="Re-plan selected plans (trigger high-reasoning refinement)">
+                               <img src="${ICON_ANALYST_MAP}" alt="Re-plan">
+                           </button>`
+                        : '';
```

**Change 2: Update the button reference in the buttonArea template (lines 1126–1127)**

- **Context:** The `buttonArea` template string includes `${analystMapBtn}`. This must be updated to `${rePlanBtn}` to match the renamed variable.
- **Implementation:**

```diff
                        ${julesBtn}
-                        ${analystMapBtn}
+                        ${rePlanBtn}
```

**Change 3: Update the guard on line 1176**

- **Context:** The click handler guard prevents actions from firing when there's no next column. `analystMapSelected` was whitelisted because it doesn't advance cards. `rePlanSelected` also doesn't advance cards, so it must be whitelisted too. Since `analystMapSelected` is being removed from the UI, it can be replaced.
- **Implementation:**

```diff
-                    if (!nextCol && action !== 'julesSelected' && action !== 'analystMapSelected' && action !== 'completeSelected' && action !== 'completeAll') return;
+                    if (!nextCol && action !== 'julesSelected' && action !== 'rePlanSelected' && action !== 'completeSelected' && action !== 'completeAll') return;
```

**Change 4: Replace `analystMapSelected` case with `rePlanSelected` in the switch block (lines 1214–1219)**

- **Context:** The switch case in the column icon button click handler sends the webview message. It must be updated to send `rePlanSelected` with `workspaceRoot` for robustness.
- **Implementation:**

```diff
-                        case 'analystMapSelected': {
-                            const ids = getSelectedInColumn(column);
-                            if (ids.length === 0) return;
-                            postKanbanMessage({ type: 'analystMapSelected', sessionIds: ids });
-                            ids.forEach(id => selectedCards.delete(id));
-                            break;
-                        }
+                        case 'rePlanSelected': {
+                            const ids = getSelectedInColumn(column);
+                            if (ids.length === 0) return;
+                            postKanbanMessage({ type: 'rePlanSelected', sessionIds: ids, workspaceRoot: getActiveWorkspaceRoot() });
+                            break;
+                        }
```

- **Edge Cases Handled:** Note that `selectedCards.delete(id)` is intentionally *removed* — re-plan does not move cards to a different column, so deselecting them would be confusing. The user's selection should persist so they can continue to interact with the same cards.

---

### [Backend] Handle Re-plan Action
#### [MODIFY] `src/services/KanbanProvider.ts`

**Change 1: Replace `analystMapSelected` case with `rePlanSelected` (lines 1970–1993)**

- **Context:** The existing `analystMapSelected` handler calls `switchboard.analystMapFromKanban`. The new `rePlanSelected` handler should call `switchboard.triggerBatchAgentFromKanban` with the `planner` role and `improve-plan` instruction, matching the pattern used throughout the file (e.g., lines 1595–1599).
- **Logic:**
  1. Resolve `workspaceRoot` from the message (falls back to active workspace if undefined).
  2. Validate `sessionIds` is a non-empty array.
  3. Call `switchboard.triggerBatchAgentFromKanban` with role `'planner'`, the session IDs, and instruction `'improve-plan'`.
  4. Show an info message confirming the dispatch.
- **Implementation:**

```diff
-            case 'analystMapSelected': {
-                const workspaceRoot = this._resolveWorkspaceRoot(msg.workspaceRoot);
-                if (!workspaceRoot || !Array.isArray(msg.sessionIds) || msg.sessionIds.length === 0) { break; }
-                const visibleAgents = await this._getVisibleAgents(workspaceRoot);
-                if (visibleAgents.analyst === false) {
-                    vscode.window.showWarningMessage('Analyst is currently disabled in setup.');
-                    break;
-                }
-                let successCount = 0;
-                for (const sessionId of msg.sessionIds) {
-                    try {
-                        const dispatched = await vscode.commands.executeCommand<boolean>('switchboard.analystMapFromKanban', sessionId, workspaceRoot);
-                        if (dispatched) { successCount++; }
-                    } catch (err) {
-                        console.error(`[KanbanProvider] Failed to send analyst map for ${sessionId}:`, err);
-                    }
-                }
-                if (successCount > 0) {
-                    vscode.window.showInformationMessage(`Sent ${successCount} plan(s) to analyst for context map generation.`);
-                } else {
-                    vscode.window.showWarningMessage('Failed to send plans to analyst for context map generation.');
-                }
-                break;
-            }
+            case 'rePlanSelected': {
+                const workspaceRoot = this._resolveWorkspaceRoot(msg.workspaceRoot);
+                if (!workspaceRoot || !Array.isArray(msg.sessionIds) || msg.sessionIds.length === 0) { break; }
+                const visibleAgents = await this._getVisibleAgents(workspaceRoot);
+                if (visibleAgents.planner === false) {
+                    vscode.window.showWarningMessage('Planner agent is currently disabled in setup.');
+                    break;
+                }
+                await vscode.commands.executeCommand(
+                    'switchboard.triggerBatchAgentFromKanban',
+                    'planner',
+                    msg.sessionIds,
+                    'improve-plan',
+                    workspaceRoot
+                );
+                vscode.window.showInformationMessage(`Sent ${msg.sessionIds.length} plan(s) to planner for re-plan (improve-plan).`);
+                break;
+            }
```

- **Edge Cases Handled:**
  - **Planner disabled:** Checks `visibleAgents.planner` and shows warning if disabled.
  - **Empty selection:** Short-circuits if `sessionIds` is empty or not an array.
  - **Missing workspaceRoot:** `_resolveWorkspaceRoot` falls back to active workspace; if null, short-circuits.

## Verification Plan
### Manual Verification
1. Open the Kanban board.
2. Ensure a planner agent is configured and visible in setup.
3. Select one or more cards in the 'Planned' (PLAN REVIEWED) column.
4. Click the re-plan button (the map icon in the column header area).
5. Verify the tooltip reads "Re-plan selected plans (trigger high-reasoning refinement)" on hover.
6. Verify that a planner terminal is spawned and receives the `improve-plan` instruction referencing the selected session IDs.
7. Verify the selected cards remain selected after the button click (no premature deselection).
8. Disable the planner agent in setup, click Re-plan, and confirm the warning message "Planner agent is currently disabled in setup." appears.
9. Verify the button does *not* appear when the planner agent is disabled (visibility guard check).

### Agent Recommendation
**Send to Coder** — all changes are direct substitutions of existing patterns. The backend handler is a copy of `julesSelected`; the webview changes are rename + guard update.
