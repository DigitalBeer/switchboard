# Kanban Board Delayed Refresh Bug

## Problem

When a card is moved to a new column, the database update is immediate, but the kanban board UI can take 5-10 seconds (or longer) to reflect the change. This creates a confusing user experience where the card appears to "snap back" or not move at all until a manual refresh or delayed sync occurs.

## Root Cause

The kanban webview uses **optimistic UI updates** — cards move in the DOM immediately on drag-drop — but this is only a visual illusion. The actual board state refresh depends on:

1. The 350ms `setTimeout` before posting messages to the extension
2. Explicit `refreshUI` or `fullSync` commands being triggered
3. No automatic "push on change" mechanism from the extension to the webview

The database (`KanbanDatabase.updateColumn`) updates synchronously, but the webview only receives `updateBoard` messages when explicitly refreshed. There's no reactive data binding.

## Current Flow

```
User drags card → DOM moves optimistically (instant)
                 ↓
         setTimeout(350ms)
                 ↓
         postMessage to extension
                 ↓
         DB update (instant)
                 ↓
         ... silence ... (up to 10s)
                 ↓
         fullSync/refreshUI finally sends updateBoard
```

## Desired Behavior

```
User drags card → DOM moves optimistically (instant)
                 ↓
         DB update (instant)
                 ↓
         Extension immediately pushes updateBoard
                 ↓
         Webview receives fresh state and reconciles
```

---

## Goal
Fix the 5-10 second kanban board refresh delay after drag-drop moves by wiring a debounced `_scheduleBoardRefresh` call immediately after every `updateColumn` in `KanbanProvider.ts`, so the board reflects DB state within ~100ms of the drop rather than waiting for the next unrelated `fullSync` or slow serial runsheet I/O to complete.

## Metadata
**Tags:** UI, backend, bugfix
**Complexity:** Low

## User Review Required
> [!NOTE]
> No breaking changes. This adds refresh calls to four message-handler cases in `KanbanProvider.ts`. The webview already handles duplicate `updateBoard` messages safely (signature comparison at kanban.html line ~2070 skips re-render when board state is unchanged).

## Complexity Audit
### Routine
- Add `_scheduleBoardRefresh(workspaceRoot?: string)` private method to `KanbanProvider` reusing the pre-existing `_refreshDebounceTimer` field (declared line 58, only cleared in `dispose()`).
- In `triggerAction` case (line ~1380): add `this._scheduleBoardRefresh(workspaceRoot ?? undefined)` before `break` — fires regardless of dispatch success so optimistic moves are authoritatively confirmed or corrected.
- In `triggerBatchAction` case (line ~1392): add `this._scheduleBoardRefresh(workspaceRoot ?? undefined)` before `break`.
- In `moveCardBackwards` case (line ~1404): add `this._scheduleBoardRefresh(workspaceRoot)` immediately AFTER the `db.updateColumn` loop, BEFORE the slow `executeCommand('switchboard.kanbanBackwardMove')` call — gives an instant refresh from the already-updated DB.
- In `moveCardForward` case (line ~1419): same pattern — schedule fast refresh after DB update, before slow `executeCommand('switchboard.kanbanForwardMove')`.

### Complex / Risky
- None

## Edge-Case & Dependency Audit
- **Race Conditions:** Two refreshes will now fire for `moveCardForward`/`moveCardBackwards`: the fast debounced one (~100ms after DB update) and the one issued by `handleKanbanForwardMove/BackwardMove` → `refreshUI` after runsheet I/O completes. The existing `_isRefreshing`/`_refreshPending` guards in `_refreshBoard` (lines 366-383) coalesce concurrent refresh requests — the second refresh enqueues itself and fires once the first completes. No data corruption risk.
- **Security:** None — this is a pure in-process timing change with no new I/O paths.
- **Side Effects:** Autoban batch operations (which already call `_refreshBoard` at every step via dozens of `await this._refreshBoard(workspaceRoot)` calls in the message handler switch) will not be affected — `_scheduleBoardRefresh` is only added to the four cases that were previously missing refreshes. `_advanceSessionsInColumn` is called only from batch operations that already refresh afterward; no change needed there.
- **Dependencies & Conflicts:** No other open Kanban plans touch `KanbanProvider` message-handler refresh logic. The previous plan ("fix workspace boundary error") only touches `extension.ts` and is fully independent.

## Adversarial Synthesis
### Grumpy Critique
*"Ah yes, the classic 'just add a refresh everywhere and call it done' plan. Let me tear this apart:*

*1. `_refreshDebounceTimer` already EXISTS at line 58 and is cleared in `dispose()`, but NEVER SET anywhere in the codebase. The plan proposes creating a brand new `_pendingRefresh` field AND a `_refreshBoardWithData` call — both wrong. Use the existing field and call `_refreshBoard` (not `_refreshBoardWithData` which bypasses the canonical `switchboard.refreshUI` → `_refreshRunSheets` pipeline and would cause the dual-read bug that was explicitly fixed in the architecture notes).*

*2. The plan lists `_advanceSessionsInColumn` as needing a fix. IT DOESN'T. Every caller of `_advanceSessionsInColumn` already calls `_refreshBoard` immediately after (check lines 1604, 1631, 1645, 1659, etc.). Adding another refresh inside `_advanceSessionsInColumn` would DOUBLE every batch refresh and is wrong.*

*3. The plan suggests adding WebSocket-style SQLite watchers. That's completely out of scope, adds infrastructure complexity, and solves a problem that doesn't exist — the real issue is just three missing `_refreshBoard` calls in the switch statement. Do not add file watchers.*

*4. Does dispatch failure in `triggerAction` need a refresh? Yes! If the agent isn't available, dispatch returns false, `updateColumn` is NOT called — but the optimistic UI already moved the card. Without a refresh, the board stays wrong until the next external event. The refresh must fire even on failed dispatch.*

*5. For `moveCardForward`/`moveCardBackwards`, the `_scheduleBoardRefresh` call must happen BEFORE `executeCommand('switchboard.kanbanForwardMove')`, not after. The command is slow (serial runsheet writes per card). The whole point is the fast-path refresh from the already-updated DB — scheduling it after the slow command defeats the purpose."*

### Balanced Response
Every point from Grumpy is valid and has been incorporated:
- Uses existing `_refreshDebounceTimer` field, no new field added.
- Calls `_refreshBoard` (not `_refreshBoardWithData`) to stay on the canonical `switchboard.refreshUI` pipeline.
- `_advanceSessionsInColumn` is explicitly excluded — its callers already refresh.
- `_scheduleBoardRefresh` fires unconditionally in `triggerAction` (even on failed dispatch) to correct a stuck optimistic state.
- For `moveCardForward`/`moveCardBackwards`, the schedule call is placed AFTER the DB update loop and BEFORE the slow `executeCommand`, giving a fast-path refresh from already-correct DB state.

## Proposed Changes
> [!IMPORTANT]
> **MAXIMUM DETAIL REQUIRED:** Provide complete, fully functioning code blocks.

### Component 1 — Add `_scheduleBoardRefresh` and wire four message-handler cases

#### MODIFY `src/services/KanbanProvider.ts`

- **Context:** Four message-handler cases in the `_panel.webview.onDidReceiveMessage` switch never call `_refreshBoard` after their DB mutations. `_refreshDebounceTimer` (line 58) is declared but never set — it exists only to be cleared in `dispose()`. This fix repurposes it as a debounce timer for the new method.

- **Logic (step-by-step):**
  1. Add `_scheduleBoardRefresh(workspaceRoot?: string): void` — clears `_refreshDebounceTimer`, schedules `_refreshBoard` after 100ms. Reuses the existing field; no new class member needed.
  2. In `triggerAction` case: after the `if (dispatched && workspaceRoot) { ... }` block (line ~1379), add `this._scheduleBoardRefresh(workspaceRoot ?? undefined)` before `break`. Fires regardless of dispatch outcome so the board is authoritatively corrected if the agent was unavailable and optimistic state is wrong.
  3. In `triggerBatchAction` case: after the `if (role && ...)` block (line ~1391), add `this._scheduleBoardRefresh(workspaceRoot ?? undefined)` before `break`.
  4. In `moveCardBackwards` case: add `this._scheduleBoardRefresh(workspaceRoot)` immediately after the `db.updateColumn` loop (after line ~1403), BEFORE `await vscode.commands.executeCommand('switchboard.kanbanBackwardMove', ...)`. This gives a fast refresh from DB within 100ms, independently of the slow runsheet I/O in `handleKanbanBackwardMove`.
  5. In `moveCardForward` case: same pattern — add `this._scheduleBoardRefresh(workspaceRoot)` after the `db.updateColumn` loop (after line ~1418), BEFORE `await vscode.commands.executeCommand('switchboard.kanbanForwardMove', ...)`.

- **Implementation:**

**Step A — Add `_scheduleBoardRefresh` method** (add after `_refreshBoardImpl`, around line 520):

```typescript
private _scheduleBoardRefresh(workspaceRoot?: string): void {
    // Reuse the pre-existing _refreshDebounceTimer field.
    // 100ms debounce collapses rapid batch drops into a single refresh call.
    if (this._refreshDebounceTimer) clearTimeout(this._refreshDebounceTimer);
    this._refreshDebounceTimer = setTimeout(() => {
        this._refreshDebounceTimer = undefined;
        void this._refreshBoard(workspaceRoot);
    }, 100);
}
```

**Step B — `triggerAction` case** (search/replace):

```typescript
// BEFORE (lines 1366-1380):
                const dispatched = await vscode.commands.executeCommand<boolean>('switchboard.triggerAgentFromKanban', role, sessionId, instruction, workspaceRoot);
                if (dispatched && workspaceRoot) {
                    await this._getKanbanDb(workspaceRoot).updateColumn(sessionId, targetColumn);

                    // Pair programming: when a high-complexity card is dispatched to Lead,
                    // also dispatch the Coder terminal with the Routine prompt.
                    // Only fires for high-complexity cards landing on LEAD CODED.
                    if (role === 'lead' && targetColumn === 'LEAD CODED') {
                        const card = this._lastCards.find(c => c.sessionId === sessionId && c.workspaceRoot === workspaceRoot);
                        if (card && !this._isLowComplexity(card) && card.complexity !== 'Unknown') {
                            await this._dispatchWithPairProgrammingIfNeeded([card], workspaceRoot);
                        }
                    }
                }
                break;

// AFTER:
                const dispatched = await vscode.commands.executeCommand<boolean>('switchboard.triggerAgentFromKanban', role, sessionId, instruction, workspaceRoot);
                if (dispatched && workspaceRoot) {
                    await this._getKanbanDb(workspaceRoot).updateColumn(sessionId, targetColumn);

                    // Pair programming: when a high-complexity card is dispatched to Lead,
                    // also dispatch the Coder terminal with the Routine prompt.
                    // Only fires for high-complexity cards landing on LEAD CODED.
                    if (role === 'lead' && targetColumn === 'LEAD CODED') {
                        const card = this._lastCards.find(c => c.sessionId === sessionId && c.workspaceRoot === workspaceRoot);
                        if (card && !this._isLowComplexity(card) && card.complexity !== 'Unknown') {
                            await this._dispatchWithPairProgrammingIfNeeded([card], workspaceRoot);
                        }
                    }
                }
                // Push authoritative DB state back to the board (~100ms).
                // Fires even on failed dispatch: corrects optimistic UI if agent was unavailable.
                this._scheduleBoardRefresh(workspaceRoot ?? undefined);
                break;
```

**Step C — `triggerBatchAction` case** (search/replace):

```typescript
// BEFORE (lines 1382-1392):
            case 'triggerBatchAction': {
                if (!this._cliTriggersEnabled) {
                    break;
                }
                const { sessionIds, targetColumn } = msg;
                const role = this._columnToRole(targetColumn);
                const workspaceRoot = this._resolveWorkspaceRoot(msg.workspaceRoot);
                if (role && Array.isArray(sessionIds) && sessionIds.length > 0) {
                    await vscode.commands.executeCommand('switchboard.triggerBatchAgentFromKanban', role, sessionIds, undefined, workspaceRoot);
                }
                break;
            }

// AFTER:
            case 'triggerBatchAction': {
                if (!this._cliTriggersEnabled) {
                    break;
                }
                const { sessionIds, targetColumn } = msg;
                const role = this._columnToRole(targetColumn);
                const workspaceRoot = this._resolveWorkspaceRoot(msg.workspaceRoot);
                if (role && Array.isArray(sessionIds) && sessionIds.length > 0) {
                    await vscode.commands.executeCommand('switchboard.triggerBatchAgentFromKanban', role, sessionIds, undefined, workspaceRoot);
                }
                this._scheduleBoardRefresh(workspaceRoot ?? undefined);
                break;
            }
```

**Step D — `moveCardBackwards` case** (search/replace):

```typescript
// BEFORE (lines 1394-1407):
            case 'moveCardBackwards': {
                const { sessionIds, targetColumn } = msg;
                const workspaceRoot = this._resolveWorkspaceRoot(msg.workspaceRoot);
                if (Array.isArray(sessionIds) && sessionIds.length > 0 && workspaceRoot) {
                    // DB-first: update column immediately so it persists across refreshes
                    const db = this._getKanbanDb(workspaceRoot);
                    if (await db.ensureReady()) {
                        for (const sid of sessionIds) {
                            await db.updateColumn(sid, targetColumn);
                        }
                    }
                    await vscode.commands.executeCommand('switchboard.kanbanBackwardMove', sessionIds, targetColumn, workspaceRoot);
                }
                break;
            }

// AFTER:
            case 'moveCardBackwards': {
                const { sessionIds, targetColumn } = msg;
                const workspaceRoot = this._resolveWorkspaceRoot(msg.workspaceRoot);
                if (Array.isArray(sessionIds) && sessionIds.length > 0 && workspaceRoot) {
                    // DB-first: update column immediately so it persists across refreshes
                    const db = this._getKanbanDb(workspaceRoot);
                    if (await db.ensureReady()) {
                        for (const sid of sessionIds) {
                            await db.updateColumn(sid, targetColumn);
                        }
                    }
                    // Fast-path: push DB-accurate state to board before slow runsheet I/O.
                    // kanbanBackwardMove will fire a second refreshUI after runsheet writes,
                    // which is harmless — _isRefreshing/_refreshPending guards coalesce it.
                    this._scheduleBoardRefresh(workspaceRoot);
                    await vscode.commands.executeCommand('switchboard.kanbanBackwardMove', sessionIds, targetColumn, workspaceRoot);
                }
                break;
            }
```

**Step E — `moveCardForward` case** (search/replace):

```typescript
// BEFORE (lines 1409-1423):
            case 'moveCardForward': {
                const { sessionIds, targetColumn } = msg;
                const workspaceRoot = this._resolveWorkspaceRoot(msg.workspaceRoot);
                if (Array.isArray(sessionIds) && sessionIds.length > 0 && workspaceRoot) {
                    // DB-first: update column immediately so it persists across refreshes
                    const db = this._getKanbanDb(workspaceRoot);
                    if (await db.ensureReady()) {
                        for (const sid of sessionIds) {
                            await db.updateColumn(sid, targetColumn);
                        }
                    }
                    await vscode.commands.executeCommand('switchboard.kanbanForwardMove', sessionIds, targetColumn, workspaceRoot);
                }
                break;
            }

// AFTER:
            case 'moveCardForward': {
                const { sessionIds, targetColumn } = msg;
                const workspaceRoot = this._resolveWorkspaceRoot(msg.workspaceRoot);
                if (Array.isArray(sessionIds) && sessionIds.length > 0 && workspaceRoot) {
                    // DB-first: update column immediately so it persists across refreshes
                    const db = this._getKanbanDb(workspaceRoot);
                    if (await db.ensureReady()) {
                        for (const sid of sessionIds) {
                            await db.updateColumn(sid, targetColumn);
                        }
                    }
                    // Fast-path: push DB-accurate state to board before slow runsheet I/O.
                    // kanbanForwardMove will fire a second refreshUI after runsheet writes,
                    // which is harmless — _isRefreshing/_refreshPending guards coalesce it.
                    this._scheduleBoardRefresh(workspaceRoot);
                    await vscode.commands.executeCommand('switchboard.kanbanForwardMove', sessionIds, targetColumn, workspaceRoot);
                }
                break;
            }
```

- **Edge Cases Handled:**
  - Double refresh for `moveCardForward`/`moveCardBackwards` is safe: `_isRefreshing` flag in `_refreshBoard` coalesces it. The first refresh (fast-path, ~100ms) uses the already-updated DB state; the second (from `refreshUI` after runsheet I/O) updates any metadata the runsheet write may have changed.
  - `workspaceRoot` is `string | null` from `_resolveWorkspaceRoot`. `?? undefined` converts null to `undefined` for `_scheduleBoardRefresh` signature (matching `_refreshBoard`'s optional parameter).
  - If the webview is closed (`!this._panel`), `_refreshBoard` returns immediately — no-op.
  - Rapid drag-drop of multiple cards: the 100ms debounce collapses overlapping `_scheduleBoardRefresh` calls into one `refreshUI` execution.

---

## Verification Plan
### Automated Tests
- Run `npx tsc --noEmit` — zero new errors required.
- Run `npm run compile` — clean webpack build required.

### Manual Tests
1. **CLI-mode single drag-drop:** Drag a card to a new column (CLI triggers ON, agent assigned). Verify board confirms the new position within ~200ms without waiting for `fullSync`.
2. **CLI-mode drag-drop, no agent:** Drag a card when no agent is assigned to the target column. Verify optimistic move is corrected (card snaps back) within ~200ms — NOT stuck in the wrong column until next fullSync.
3. **Prompt-mode forward move:** Drag card forward with CLI triggers OFF. Verify board reflects correct position within ~200ms rather than 5-10 seconds.
4. **Backward move:** Use context menu or drag backwards. Verify instant board update.
5. **Batch drag-drop (5+ cards):** Select 5 cards, drag to new column. Verify board refreshes ONCE (debounced), not 5 times.
6. **Autoban batch move (regression):** Trigger autoban. Verify no new jarring intermediate refreshes — autoban already calls `_refreshBoard` after each step; `_scheduleBoardRefresh` should not be called from `_advanceSessionsInColumn`.

## Acceptance Criteria

- [ ] Card moves appear permanent within 200ms of drop
- [ ] No manual "Sync Board" button press required
- [ ] Batch operations (move 5 cards) refresh once, not 5 times
- [ ] Autoban engine updates don't cause jarring refreshes

## Files to Modify

- `src/services/KanbanProvider.ts` — Add `_scheduleBoardRefresh` and wire four message-handler cases

---

## Review Results

### Grumpy Principal Engineer Findings

#### MAJOR — `triggerAction` `!canDispatch` escape hatch swallows the optimistic-move correction
**File:** `src/services/KanbanProvider.ts`, lines 1371–1373 (pre-fix)

The implementation added `_scheduleBoardRefresh` after the `dispatched` if-block at line 1392, which is the correct relative placement per the plan. However, an earlier early-break (`if (!canDispatch) { break; }`) at line 1372 was left untouched. When `_canAssignRole` returns false (no terminal registered, role full, etc.), the user's drag-drop has already moved the card optimistically in the DOM, no DB update occurred, and the board now shows wrong state. `_scheduleBoardRefresh` never fires in this path, defeating the plan's stated purpose: *"Fires even on failed dispatch: corrects optimistic UI if agent was unavailable."* The comment at line 1390–1391 even contradicts the code by claiming the call fires unconditionally.

**Impact:** The primary use-case for the `triggerAction` refresh (correcting stuck optimistic UI when dispatch fails) is broken for the most common failure path.

#### NIT — `_scheduleBoardRefresh` method placement is slightly late in file
**File:** `src/services/KanbanProvider.ts`, line 622

Method sits 100 lines after `_refreshBoard`/`_refreshBoardImpl`. Thematically fine, no functional impact.

#### NIT — `triggerBatchAction` `!_cliTriggersEnabled` early break still skips refresh
In practice unreachable (webview won't send `triggerBatchAction` when CLI is off), so no real exposure. Inconsistent with `moveCard*` cases but not worth touching.

#### VERIFIED CORRECT — All other plan requirements

| Requirement | Status |
|---|---|
| `_scheduleBoardRefresh` method — uses `_refreshDebounceTimer`, 100ms, calls `_refreshBoard` | ✅ lines 622–630 |
| Calls `_refreshBoard` (NOT `_refreshBoardWithData`) | ✅ line 628 |
| `triggerBatchAction`: call after if-block, before break | ✅ line 1405 |
| `moveCardBackwards`: call after `db.updateColumn` loop, BEFORE `executeCommand` | ✅ line 1422 |
| `moveCardForward`: call after `db.updateColumn` loop, BEFORE `executeCommand` | ✅ line 1441 |
| `_advanceSessionsInColumn`: NOT touched | ✅ confirmed |

---

### Balanced Synthesis

**Keep as-is:** `_scheduleBoardRefresh` method, `triggerBatchAction`/`moveCardBackwards`/`moveCardForward` wiring, `_advanceSessionsInColumn` correctly untouched.

**Fixed (MAJOR):** Restructured `triggerAction` — replaced the `if (!canDispatch) { break; }` early-exit with an inner `if (canDispatch) { ... }` block. `_scheduleBoardRefresh` now fires unconditionally (whether `canDispatch` is true or false), matching the plan's stated intent that the call corrects optimistic UI regardless of dispatch outcome.

**Deferred (NIT):** Method placement, `triggerBatchAction` CLI guard — cosmetic/unreachable, no action.

---

### Files Changed

- `src/services/KanbanProvider.ts` — Restructured `triggerAction` case: replaced `if (!canDispatch) { break; }` with `if (canDispatch) { ... }` block so `_scheduleBoardRefresh` fires unconditionally.

---

### Validation Results (TypeScript)

```
src/services/KanbanProvider.ts(1493,57): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean './ArchiveManager.js'?
```

**Pre-existing error, unrelated to this change** (line 1493 = `ArchiveManager` import, unchanged by this fix). No new TypeScript errors introduced.

---

### Remaining Risks

- **`!_cliTriggersEnabled` early break in `triggerBatchAction`** (line 1396–1398): If CLI triggers are ever disabled mid-session while a batch drag is in-flight, the refresh is skipped. Practically unreachable but technically inconsistent.
- **`!role` early break in `triggerAction`** (line 1365–1367): Drag to a non-role column skips refresh. Low risk — `triggerAction` is only sent by the webview for role-mapped columns.
- **Double refresh for `moveCardForward`/`moveCardBackwards`** is expected and harmless (coalesced by `_isRefreshing`/`_refreshPending` guards), as documented in the plan.
