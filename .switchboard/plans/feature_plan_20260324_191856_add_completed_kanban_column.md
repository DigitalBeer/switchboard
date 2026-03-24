# Add Completed Kanban Column

## Goal
Add a **'Completed'** column to the right of the existing 'Reviewed' column on the Kanban board. Dragging cards here (or using column buttons) marks them as complete — identical to the existing sidebar "Complete Plan" action. Completed/archived cards are displayed in this column. Dragging a card **out** of the Completed column recovers it from archive and makes it active again.

## User Review Required
> [!NOTE]
> - The Completed column will appear as the new rightmost column on the Kanban board for all users immediately.
> - Existing completed/archived plans will now be visible on the board (they were previously hidden).
> - The 'Reviewed' column gains two new icon buttons (Move Selected → Completed, Move All → Completed). No prompt/CLI dispatch controls are added — this is a terminal stage.
> - Recovering a card by dragging it out of 'Completed' into an earlier column reverses the archive process (removes tombstone, restores run sheet, restores plan file from archive).

## Complexity Audit

### Routine
- **R1**: Add `'COMPLETED'` to `DEFAULT_KANBAN_COLUMNS` in `agentConfig.ts` with `kind: 'completed'`, `order: 400`, `role: undefined`, `autobanEnabled: false`.
- **R2**: Add `'COMPLETED'` to `VALID_KANBAN_COLUMNS` set in `KanbanDatabase.ts`.
- **R3**: Add `'COMPLETED'` case returning `null` in `KanbanProvider._columnToRole()`.
- **R4**: Add `'COMPLETED'` abbreviation to `COLUMN_ABBREV` in `kanban.html` (e.g. `'COMPLETED': 'D'` for "Done").
- **R5**: Update `renderColumns()` in `kanban.html` so the 'Reviewed' column is no longer treated as `isLastColumn` and gains Move Selected / Move All icon buttons (no prompt buttons, no Jules/Analyst buttons).
- **R6**: Update `renderColumns()` in `kanban.html` so the new 'COMPLETED' column (now `isLastColumn`) gets no action buttons (empty button area, same as old Reviewed column).
- **R7**: Completed column cards should render **without** the "Complete Plan" (checkmark) button since they are already completed. Keep the "Review Plan Ticket" and "Copy Prompt" buttons for inspection.
- **R8**: Add `'completed'` to the `kind` union in `KanbanColumnDefinition` interface in `agentConfig.ts`.

### Complex / Risky
- **C1**: **Fetch completed cards for the board** — `KanbanProvider._refreshBoardImpl()` currently only sends `active` cards. Must add a parallel query for `status = 'completed'` plans from the DB (and file-based fallback) and merge them into the card list with `column: 'COMPLETED'`.
- **C2**: **Handle drag-to-Completed (forward move)** — When a card is dropped on the COMPLETED column (forward direction), the backend must call the existing `_handleCompletePlan()` logic (archive brain plan, mark runsheet completed, update DB status, archive session). This is NOT a simple column move — it's an archive operation.
- **C3**: **Handle drag-out-of-Completed (backward move / recovery)** — When a card is dragged OUT of the COMPLETED column to an earlier column, the backend must call the existing `_handleRestorePlan()` logic (restore tombstone, restore runsheet, restore plan file from archive, update registry status to active). Then apply a backward column move to the target column.
- **C4**: **"Move Selected" and "Move All" on Reviewed column** — These buttons must call `completePlan` for each card (archive flow), NOT a simple `moveCardForward` message. Requires a new webview message type (e.g. `'completeSelected'` / `'completeAll'`) or reuse existing `completePlan` in a loop.
- **C5**: **Webview `handleDrop` interaction** — The drop handler currently classifies moves as forward/backward by column index and sends `triggerAction`/`moveCardForward`/`moveCardBackwards`. Drops INTO COMPLETED must be intercepted to send `completePlan` instead. Drops OUT OF COMPLETED must send a new `'uncompleteCard'` message type.

## Edge-Case & Dependency Audit
- **Race Conditions:** A card could be completed via the sidebar checkmark button simultaneously with a kanban drag-to-completed. Both paths converge on `_handleCompletePlan()` which reads the runsheet, checks `sheet.completed`, and early-returns if already true. The existing guard is sufficient — double-complete is a no-op.
- **Security:** No new external inputs. Column name `'COMPLETED'` is a hardcoded built-in string, validated by `VALID_KANBAN_COLUMNS` set and `SAFE_COLUMN_NAME_RE`. The uncomplete/restore path reuses `_handleRestorePlan()` which validates registry status and brain file existence.
- **Side Effects:** Completed cards appearing on the board is a UI behavior change. Users who relied on "complete = disappear from board" will now see them in the Completed column. This is the intended design.
- **Backward Compatibility:** Cards already marked `completed` in the DB will appear in the new column immediately. Cards archived before the DB existed (file-based only, `completed: true` in runsheet) will also appear if the file-based fallback path is updated.
- **Dependencies & Conflicts:** No active plans in the Kanban board conflict with this feature. The feature builds on the existing `completePlan`/`restorePlan` infrastructure which is stable.

## Adversarial Synthesis

### Grumpy Critique

*Adjusts reading glasses, sighs theatrically.*

Oh WONDERFUL, another column. Let me count the ways this can go sideways:

1. **The "fetch completed cards" query is going to be a performance landmine.** Right now `getBoard()` returns `WHERE status = 'active'`. You're about to add a second query for ALL completed plans — ever. No cap? No pagination? A workspace with 500 completed plans is going to render 500 cards in that column. Enjoy your 2-second board refresh. You NEED a cap (e.g. last 50 completed by `updated_at DESC`) or a "load more" mechanism.

2. **The file-based fallback is a horror show.** `_getActiveSheets()` explicitly does `if (sheet.completed) continue;`. You need a SECOND code path to gather completed sheets. But completed sessions may have been moved to `archive/sessions/` by `_archiveCompletedSession()`. Are you going to scan that directory too? Every refresh? That's an `O(n)` filesystem scan on EVERY board refresh for the fallback path.

3. **Drag-out-of-Completed recovery is more complex than you think.** `_handleRestorePlan()` currently works by `planId` from the plan registry. But the kanban card only carries `sessionId`. You need to resolve `sessionId → planId` for the restore call. For brain plans, that's `antigravity_<hash>` → strip prefix → look up registry. For local plans, `sessionId === planId`. If this mapping is wrong, you silently fail to restore.

4. **The "Move Selected/All" on Reviewed column calling completePlan in a loop** — what happens if plan 3 of 5 fails to archive? Do you stop? Continue? Roll back? The user sees 2 cards vanish and 3 stay. Delightful UX.

5. **You haven't thought about the `updateColumns` message.** The webview receives column definitions from the backend via `updateColumns`. The `kind: 'completed'` needs to be recognized by the frontend to suppress prompt/CLI buttons. Currently the frontend only checks `isCreated` and `isLastColumn`. You need explicit `isCompleted` handling.

6. **The card HTML for completed plans should look VISUALLY DISTINCT.** A muted/dimmed style, a "✓ Completed" badge — something. Otherwise the user drags a card to Completed and… it looks exactly the same. Zero feedback that anything happened.

### Balanced Response

The Grumpy critique raises valid concerns. Here's how each is addressed in the implementation below:

1. **Performance cap** — The `getCompletedPlans()` DB method will use `ORDER BY updated_at DESC LIMIT 100`. The file-based fallback will similarly cap at 100 most-recent. This prevents unbounded growth. A "load more" mechanism is out of scope for this plan but the cap makes it safe.

2. **File-based fallback** — Rather than scanning `archive/sessions/`, the fallback will use `SessionActionLog.getCompletedRunSheets()` which already exists and scans the active sessions dir for `completed: true` sheets. Archived sessions that were moved out of the sessions dir are excluded from the fallback — the DB is the authoritative source for those. This is an acceptable degradation.

3. **sessionId → planId mapping for restore** — The `KanbanDatabase` already stores `planId` alongside `sessionId`. The new `uncompleteCard` handler will first look up the `planId` from the DB, then call `_handleRestorePlan(planId)`. If the DB is unavailable, fall back to checking if `sessionId` starts with `antigravity_` (brain plan) or is a direct local plan ID.

4. **Batch complete error handling** — The loop will continue on failure and report the count of successful/failed completions via `vscode.window.showInformationMessage`. This matches the existing pattern for batch moves.

5. **Frontend `isCompleted` handling** — `renderColumns()` will check `def.kind === 'completed'` (propagated via the `updateColumns` message) to suppress all action buttons and mode toggles. The existing `isLastColumn` logic is preserved for the empty button area.

6. **Visual distinction** — Completed cards will get a `.completed` CSS class with reduced opacity (0.7), a subtle green left-border, and the "Complete Plan" button replaced by a "✓ Done" badge. The column header will use a muted green accent.

## Proposed Changes

> [!IMPORTANT]
> **MAXIMUM DETAIL REQUIRED:** Complete code blocks and step-by-step logic for every file change.

### 1. Column Definition & Type Updates
#### [MODIFY] `src/services/agentConfig.ts`
- **Context:** The `KanbanColumnDefinition` interface defines the `kind` union and `DEFAULT_KANBAN_COLUMNS` defines the built-in columns. A new 'COMPLETED' column must be added as the final pipeline stage.
- **Logic:**
  1. Add `'completed'` to the `kind` union type in `KanbanColumnDefinition`.
  2. Append a new entry to `DEFAULT_KANBAN_COLUMNS` with `id: 'COMPLETED'`, `label: 'Completed'`, `role: undefined`, `order: 400`, `kind: 'completed'`, `autobanEnabled: false`, `dragDropMode: 'cli'`.
- **Implementation:**
```typescript
// In KanbanColumnDefinition interface, update kind union:
kind: 'created' | 'review' | 'coded' | 'reviewed' | 'custom' | 'completed';

// In DEFAULT_KANBAN_COLUMNS array, append after CODE REVIEWED:
{ id: 'COMPLETED', label: 'Completed', order: 400, kind: 'completed', autobanEnabled: false, dragDropMode: 'cli' },
```
- **Edge Cases Handled:** `order: 400` ensures it sorts after CODE REVIEWED (order 300) and after any custom agents using `DEFAULT_CUSTOM_AGENT_KANBAN_ORDER` (which is 400 — **Clarification**: must verify `DEFAULT_CUSTOM_AGENT_KANBAN_ORDER` value and potentially increase COMPLETED order to 9999 to guarantee it's always last).

### 2. Database Valid Columns
#### [MODIFY] `src/services/KanbanDatabase.ts`
- **Context:** `VALID_KANBAN_COLUMNS` is a hardcoded allowlist for column validation. `getBoard()` only returns active plans.
- **Logic:**
  1. Add `'COMPLETED'` to `VALID_KANBAN_COLUMNS`.
  2. Add a `getCompletedPlans()` method that queries `WHERE status = 'completed'` with a cap of 100 rows ordered by `updated_at DESC`.
  3. Add a `getPlanBySessionId()` method to resolve `sessionId → planId` for the uncomplete flow.
- **Implementation:**
```typescript
// Add 'COMPLETED' to VALID_KANBAN_COLUMNS:
const VALID_KANBAN_COLUMNS = new Set([
    'CREATED', 'PLAN REVIEWED', 'LEAD CODED', 'CODER CODED', 'CODE REVIEWED', 'CODED', 'COMPLETED'
]);

// New method: getCompletedPlans
public async getCompletedPlans(workspaceId: string, limit: number = 100): Promise<KanbanPlanRecord[]> {
    if (!(await this.ensureReady()) || !this._db) return [];
    const stmt = this._db.prepare(
        `SELECT plan_id, session_id, topic, plan_file, kanban_column, status, complexity,
                workspace_id, created_at, updated_at, last_action, source_type
         FROM plans
         WHERE workspace_id = ? AND status = 'completed'
         ORDER BY updated_at DESC
         LIMIT ?`,
        [workspaceId, limit]
    );
    return this._readRows(stmt);
}

// New method: getPlanBySessionId
public async getPlanBySessionId(sessionId: string): Promise<KanbanPlanRecord | null> {
    if (!(await this.ensureReady()) || !this._db) return null;
    const stmt = this._db.prepare(
        `SELECT plan_id, session_id, topic, plan_file, kanban_column, status, complexity,
                workspace_id, created_at, updated_at, last_action, source_type
         FROM plans
         WHERE session_id = ? LIMIT 1`,
        [sessionId]
    );
    const rows = this._readRows(stmt);
    return rows.length > 0 ? rows[0] : null;
}
```
- **Edge Cases Handled:** The `LIMIT 100` prevents unbounded growth. `getPlanBySessionId` returns `null` if DB is unavailable, triggering fallback logic in the caller.

### 3. KanbanProvider — Fetch & Display Completed Cards
#### [MODIFY] `src/services/KanbanProvider.ts`
- **Context:** `_refreshBoardImpl()` builds the card list from active sheets only. Completed cards must also be sent to the webview with `column: 'COMPLETED'`.
- **Logic:**
  1. After building the `cards` array from active sheets, query `db.getCompletedPlans(workspaceId)` to get completed plan records.
  2. Map completed DB records to `KanbanCard` objects with `column: 'COMPLETED'`.
  3. Merge them into the `cards` array before posting to webview.
  4. If DB is unavailable, use `SessionActionLog.getCompletedRunSheets()` as fallback (capped at 100).
- **Implementation (within `_refreshBoardImpl`, after the existing `cards` assignment and DB sync block):**
```typescript
// Fetch completed plans from DB and append as COMPLETED column cards
if (workspaceId && await db.ensureReady()) {
    const completedRecords = await db.getCompletedPlans(workspaceId, 100);
    const completedCards: KanbanCard[] = completedRecords.map(rec => ({
        sessionId: rec.sessionId,
        topic: rec.topic || rec.planFile || 'Untitled',
        planFile: rec.planFile || '',
        column: 'COMPLETED',
        lastActivity: rec.updatedAt || rec.createdAt || '',
        complexity: rec.complexity || 'Unknown',
        workspaceRoot: resolvedWorkspaceRoot
    }));
    cards.push(...completedCards);
} else {
    // File-based fallback: scan completed runsheets
    try {
        const completedSheets = await log.getCompletedRunSheets();
        const cappedSheets = completedSheets
            .sort((a: any, b: any) => (b.completedAt || '').localeCompare(a.completedAt || ''))
            .slice(0, 100);
        const fallbackCompletedCards: KanbanCard[] = cappedSheets.map((sheet: any) => ({
            sessionId: sheet.sessionId,
            topic: sheet.topic || sheet.planFile || 'Untitled',
            planFile: sheet.planFile || '',
            column: 'COMPLETED',
            lastActivity: sheet.completedAt || '',
            complexity: (sheet.complexity as any) || 'Unknown',
            workspaceRoot: resolvedWorkspaceRoot
        }));
        cards.push(...fallbackCompletedCards);
    } catch (e) {
        console.warn('[KanbanProvider] Failed to fetch completed sheets for fallback:', e);
    }
}
```
- **Edge Cases Handled:** DB unavailable gracefully falls back to file scan. Cap of 100 prevents performance issues.

### 4. KanbanProvider — Column Role Mapping & Message Handlers
#### [MODIFY] `src/services/KanbanProvider.ts`
- **Context:** `_columnToRole()` maps columns to agent roles for dispatch. COMPLETED has no agent. New message types are needed for complete/uncomplete from Kanban drag-and-drop.
- **Logic:**
  1. Add `'COMPLETED': return null;` to `_columnToRole()`.
  2. Add `'completeSelected'` message handler: loop through `sessionIds`, call `completePlanFromKanban` for each, report results.
  3. Add `'completeAll'` message handler: get all cards in 'CODE REVIEWED' column, complete each.
  4. Add `'uncompleteCard'` message handler: resolve `sessionId → planId`, call `restorePlan`, then apply backward column move.
  5. Update the `handleDrop` forward-move path: if `targetColumn === 'COMPLETED'`, send `completePlan` instead of `triggerAction`.
- **Implementation (message handler additions in `_handleMessage` switch):**
```typescript
case 'completeSelected': {
    const workspaceRoot = this._resolveWorkspaceRoot(msg.workspaceRoot);
    if (!workspaceRoot || !Array.isArray(msg.sessionIds) || msg.sessionIds.length === 0) { break; }
    let successCount = 0;
    for (const sessionId of msg.sessionIds) {
        const ok = await vscode.commands.executeCommand<boolean>('switchboard.completePlanFromKanban', sessionId, workspaceRoot);
        if (ok) { successCount++; }
    }
    await this._refreshBoard(workspaceRoot);
    vscode.window.showInformationMessage(`Completed ${successCount} of ${msg.sessionIds.length} plans.`);
    break;
}
case 'completeAll': {
    const workspaceRoot = this._resolveWorkspaceRoot(msg.workspaceRoot);
    if (!workspaceRoot) { break; }
    await this._refreshBoard(workspaceRoot);
    const reviewedCards = this._lastCards.filter(card => card.workspaceRoot === workspaceRoot && card.column === 'CODE REVIEWED');
    if (reviewedCards.length === 0) {
        vscode.window.showInformationMessage('No plans in Reviewed to complete.');
        break;
    }
    let successCount = 0;
    for (const card of reviewedCards) {
        const ok = await vscode.commands.executeCommand<boolean>('switchboard.completePlanFromKanban', card.sessionId, workspaceRoot);
        if (ok) { successCount++; }
    }
    await this._refreshBoard(workspaceRoot);
    vscode.window.showInformationMessage(`Completed ${successCount} of ${reviewedCards.length} plans.`);
    break;
}
case 'uncompleteCard': {
    const workspaceRoot = this._resolveWorkspaceRoot(msg.workspaceRoot);
    if (!workspaceRoot || !Array.isArray(msg.sessionIds) || msg.sessionIds.length === 0) { break; }
    const targetColumn = msg.targetColumn || 'CODE REVIEWED';
    let successCount = 0;
    for (const sessionId of msg.sessionIds) {
        // Resolve sessionId → planId via DB
        const db = this._getKanbanDb(workspaceRoot);
        let planId: string | null = null;
        if (await db.ensureReady()) {
            const record = await db.getPlanBySessionId(sessionId);
            if (record) { planId = record.planId; }
        }
        // Fallback: for brain plans sessionId starts with 'antigravity_', planId is the hash suffix
        // For local plans, sessionId === planId
        if (!planId) {
            planId = sessionId.startsWith('antigravity_') ? sessionId.replace('antigravity_', '') : sessionId;
        }
        const ok = await vscode.commands.executeCommand<boolean>('switchboard.restorePlanFromKanban', planId, workspaceRoot);
        if (ok) {
            // Apply backward column move to target
            await vscode.commands.executeCommand('switchboard.kanbanBackwardMove', [sessionId], targetColumn, workspaceRoot);
            successCount++;
        }
    }
    await this._refreshBoard(workspaceRoot);
    vscode.window.showInformationMessage(`Recovered ${successCount} of ${msg.sessionIds.length} plans.`);
    break;
}
```
- **Edge Cases Handled:** `planId` fallback logic handles both brain and local plans when DB is unavailable. Batch continues on individual failure and reports counts.

### 5. KanbanProvider — `_getNextColumnId` Update
#### [MODIFY] `src/services/KanbanProvider.ts`
- **Context:** `_getNextColumnId()` computes the next column in the pipeline. Currently 'CODE REVIEWED' returns `null` (last column). After adding COMPLETED, CODE REVIEWED → COMPLETED should be valid, but COMPLETED → null.
- **Logic:** No code change needed — `_getNextColumnId()` already uses `buildKanbanColumns()` and finds the next column by index. Adding COMPLETED with `order: 400` automatically makes it the successor to CODE REVIEWED. The `kind` check (`allColumns[i].kind !== currentKind`) will work because `'completed' !== 'reviewed'`.
- **Edge Cases Handled:** The `_getNextColumnId` skip-same-kind logic is safe because only `'coded'` kind has parallel lanes (LEAD CODED, CODER CODED). COMPLETED has unique kind.

### 6. Webview — Column Rendering & Completed Column UI
#### [MODIFY] `src/webview/kanban.html`
- **Context:** `renderColumns()` renders column headers and button areas. The last column gets a hidden placeholder. The Reviewed column needs Move Selected / Move All buttons for completing. The new COMPLETED column needs distinct styling.
- **Logic:**
  1. Add `const isCompleted = def.kind === 'completed';` check in `renderColumns()`.
  2. The Reviewed column (`def.kind === 'reviewed'`) is NO LONGER `isLastColumn`. It gets Move Selected and Move All buttons that send `completeSelected` / `completeAll` messages.
  3. The COMPLETED column IS `isLastColumn`. It gets the empty placeholder button area (existing behavior).
  4. COMPLETED column gets no mode toggle, no agent subline.
  5. Add CSS for `.kanban-column[data-column="COMPLETED"]` with muted green accent.
  6. Update `COLUMN_ABBREV` to include `'COMPLETED': 'D'`.
- **Implementation (key changes in renderColumns):**

For the Reviewed column button area (when `def.kind === 'reviewed'`):
```html
<div class="column-button-area">
    <button class="column-icon-btn" data-action="completeSelected" data-column="${escapeAttr(def.id)}" title="Complete selected plans (archive)">
        <img src="${ICON_MOVE_SELECTED}" alt="Complete Selected">
    </button>
    <button class="column-icon-btn" data-action="completeAll" data-column="${escapeAttr(def.id)}" title="Complete all plans in this column (archive)">
        <img src="${ICON_MOVE_ALL}" alt="Complete All">
    </button>
</div>
```

For the column-icon-btn click handler, add two new cases:
```javascript
case 'completeSelected': {
    const ids = getSelectedInColumn(column);
    if (ids.length === 0) return;
    postKanbanMessage({ type: 'completeSelected', sessionIds: ids, workspaceRoot: getActiveWorkspaceRoot() });
    ids.forEach(id => selectedCards.delete(id));
    break;
}
case 'completeAll': {
    const ids = getAllInColumn(column);
    if (ids.length === 0) return;
    postKanbanMessage({ type: 'completeAll', workspaceRoot: getActiveWorkspaceRoot() });
    ids.forEach(id => selectedCards.delete(id));
    break;
}
```
- **Edge Cases Handled:** The `isLastColumn` check now correctly identifies COMPLETED as last. Reviewed column buttons only fire archive operations, not prompt/CLI dispatches.

### 7. Webview — Drop Handler for Completed Column
#### [MODIFY] `src/webview/kanban.html`
- **Context:** `handleDrop()` classifies drops as forward/backward and dispatches accordingly. Drops INTO COMPLETED must trigger `completePlan`. Drops OUT OF COMPLETED must trigger `uncompleteCard`.
- **Logic:**
  1. In `handleDrop()`, after computing `forwardIds` and `backwardIds`, check if `targetColumn === 'COMPLETED'`. If so, override the forward-move path to send `completePlan` messages instead of `triggerAction`/`moveCardForward`.
  2. Check if any card's `card.column === 'COMPLETED'` (source is COMPLETED column). If so, classify those as `uncompleteIds` and send `uncompleteCard` message with the `targetColumn`.
- **Implementation (insert in handleDrop, within the setTimeout callback):**
```javascript
// Special handling: forward drops INTO COMPLETED trigger archive, not dispatch
if (targetColumn === 'COMPLETED' && forwardIds.length > 0) {
    forwardIds.forEach(id => {
        const card = currentCards.find(c => c.sessionId === id);
        postKanbanMessage({ type: 'completePlan', sessionId: id, workspaceRoot: card?.workspaceRoot || getActiveWorkspaceRoot() });
    });
    // Don't send triggerAction/moveCardForward for these
    forwardIds.length = 0;
}

// Special handling: backward drags FROM COMPLETED trigger uncomplete/restore
const uncompleteIds = backwardIds.filter(id => {
    const card = currentCards.find(c => c.sessionId === id);
    return card && card.column === 'COMPLETED';
});
if (uncompleteIds.length > 0) {
    postKanbanMessage({ type: 'uncompleteCard', sessionIds: uncompleteIds, targetColumn, workspaceRoot });
    // Remove from backwardIds so they don't also get a moveCardBackwards
    uncompleteIds.forEach(id => {
        const idx = backwardIds.indexOf(id);
        if (idx >= 0) backwardIds.splice(idx, 1);
    });
}
```
- **Edge Cases Handled:** Cards dragged from COMPLETED are separated from normal backward moves. Forward drops to COMPLETED bypass CLI dispatch entirely.

### 8. Webview — Card Rendering for Completed Column
#### [MODIFY] `src/webview/kanban.html`
- **Context:** `createCardHtml()` renders each card. Completed cards need visual distinction and no "Complete" button.
- **Logic:**
  1. If `card.column === 'COMPLETED'`, add a `completed` CSS class to the card div.
  2. Replace the "Complete Plan" (checkmark) button with a "✓ Done" text badge.
  3. Keep the "Review Plan Ticket" button and "Copy Prompt" button.
- **Implementation (in createCardHtml):**
```javascript
const isCompleted = card.column === 'COMPLETED';
const completedClass = isCompleted ? ' completed' : '';
// ... in the card-actions div:
const completeOrDoneBtn = isCompleted
    ? '<span class="card-done-badge" title="Plan completed">✓ Done</span>'
    : `<button class="card-btn icon-btn complete" data-session="${card.sessionId}" data-workspace-root="${escapeAttr(card.workspaceRoot)}" title="Complete Plan">
           <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-6"/></svg>
       </button>`;
```
- **CSS additions:**
```css
.kanban-card.completed {
    opacity: 0.7;
    border-left: 3px solid var(--vscode-testing-iconPassed, #73c991);
}
.kanban-card.completed:hover {
    opacity: 0.85;
}
.card-done-badge {
    font-size: 10px;
    color: var(--vscode-testing-iconPassed, #73c991);
    padding: 2px 6px;
    border: 1px solid var(--vscode-testing-iconPassed, #73c991);
    border-radius: 3px;
    white-space: nowrap;
}
```
- **Edge Cases Handled:** Completed cards are visually distinct. The ✓ badge is non-interactive. Review and Copy buttons remain functional for inspection.

### 9. Extension Command Registration
#### [MODIFY] `src/extension.ts` (or wherever commands are registered)
- **Context:** A new `switchboard.restorePlanFromKanban` command is needed for the uncomplete flow. The existing `switchboard.completePlanFromKanban` command is already registered.
- **Logic:** Register a command that calls `TaskViewerProvider._handleRestorePlan()` with the provided `planId` and `workspaceRoot`.
- **Implementation:**
```typescript
vscode.commands.registerCommand('switchboard.restorePlanFromKanban', async (planId: string, workspaceRoot?: string) => {
    return taskViewerProvider.handleKanbanRestorePlan(planId, workspaceRoot);
});
```
- **Edge Cases Handled:** Returns `boolean` success indicator consistent with other kanban commands.

### 10. TaskViewerProvider — Public Restore Handler
#### [MODIFY] `src/services/TaskViewerProvider.ts`
- **Context:** `_handleRestorePlan()` is private. Need a public wrapper for the kanban command.
- **Logic:** Add `handleKanbanRestorePlan(planId, workspaceRoot)` that delegates to `_handleRestorePlan(planId)` after resolving workspace root.
- **Implementation:**
```typescript
public async handleKanbanRestorePlan(planId: string, workspaceRoot?: string): Promise<boolean> {
    // _handleRestorePlan resolves workspace root internally
    return await this._handleRestorePlan(planId);
}
```
- **Edge Cases Handled:** Reuses all existing restore logic including tombstone removal, runsheet recovery, plan file restoration.

## Verification Plan

### Automated Tests
- **Existing test coverage:** Run all existing kanban tests in `src/test/` to ensure no regression. Key files:
  - `src/test/agent-config-drag-drop-mode.test.js` — verify COMPLETED column appears in `buildKanbanColumns()` output.
  - Any tests referencing `VALID_KANBAN_COLUMNS` or `_columnToRole`.
- **New tests to write:**
  1. **`agentConfig` unit test:** Verify `buildKanbanColumns([])` includes a `COMPLETED` entry with `kind: 'completed'`, `order: 400`, and it's the last element.
  2. **`KanbanDatabase` unit test:** Verify `getCompletedPlans()` returns only `status = 'completed'` rows, capped at limit.
  3. **`KanbanProvider` integration test:** Verify that `_refreshBoardImpl` includes completed cards with `column: 'COMPLETED'` in the posted message.
  4. **Drop handler test:** Verify forward drop to COMPLETED sends `completePlan` message, not `triggerAction`.
  5. **Uncomplete test:** Verify dragging card from COMPLETED to earlier column sends `uncompleteCard` and card reappears as active.

### Manual Verification
1. Open Kanban board → verify COMPLETED column appears as rightmost column.
2. Complete a plan via sidebar checkmark → verify it appears in COMPLETED column.
3. Drag a card from Reviewed to COMPLETED → verify it archives (removed from sidebar dropdown, appears in COMPLETED column with ✓ Done badge and green border).
4. Drag a card FROM COMPLETED to an earlier column (e.g. CREATED) → verify it's restored (reappears in sidebar dropdown, active in target column).
5. Click "Move Selected" on Reviewed column → verify selected cards move to COMPLETED.
6. Click "Move All" on Reviewed column → verify all Reviewed cards move to COMPLETED.
7. Verify no prompt/CLI buttons appear on COMPLETED column.
8. Verify completed cards show reduced opacity and green left-border.

## Open Questions
- **Q1 (Resolved):** Should `DEFAULT_CUSTOM_AGENT_KANBAN_ORDER` be updated? **Answer:** Yes — COMPLETED's `order` should be set to `9999` (not `400`) to guarantee it's always last, even after custom agents. The `DEFAULT_CUSTOM_AGENT_KANBAN_ORDER` is currently `400`, which would collide. Use `order: 9999`.
- **Q2:** Should there be a configurable cap for completed cards displayed? For now, hardcoded at 100 is sufficient. Can be made configurable later via `switchboard.completedCardLimit` setting if needed.

---

## Post-Implementation Review

### Review Date
2026-03-24

### Reviewer Findings (Grumpy Critique)

#### CRITICAL-1: Compiled JS Files Out of Sync 🔴
The `.ts` source files were updated but the manually-maintained `.js` files (`agentConfig.js`, `KanbanDatabase.js`, `KanbanProvider.js`, `extension.js`, `TaskViewerProvider.js`) were NOT synced. Since `tsconfig.json` has `noEmit: true`, these `.js` files are the runtime artifacts used by tests and the extension. **None of the new features worked at runtime.**

#### CRITICAL-2: `DEFAULT_CUSTOM_AGENT_KANBAN_ORDER` Broken by `order: 9999` 🔴
With COMPLETED at `order: 9999`, the dynamic computation `Math.max(300, ...DEFAULT_KANBAN_COLUMNS.map(c => c.order)) + 100` evaluated to `10099`. Custom agents without explicit `kanbanOrder` would sort AFTER Completed, defeating the purpose of making Completed always last.

#### CRITICAL-3: `_handleRestorePlan` Never Updates Kanban DB Status 🔴
The `uncompleteCard` handler called `restorePlanFromKanban` → `_handleRestorePlan()` which updates the plan **registry** status to `'active'` but does NOT touch the Kanban DB status. Then `kanbanBackwardMove` updates the DB column but NOT the status. Result: DB status stays `'completed'`, `getBoard()` (`WHERE status='active'`) won't find the card, and `getCompletedPlans()` will — the card teleports back to COMPLETED on every refresh.

#### MAJOR-1: No Optimistic DOM Update for Drag-to-COMPLETED 🟡
When cards are forward-dropped to COMPLETED, `forwardIds.length = 0` runs before the optimistic DOM loop, so `validIds` contains zero forward IDs. The card snaps back to its source column on `dragend`, then reappears in COMPLETED after backend refresh. Poor UX compared to smooth animations on other columns.

#### MAJOR-2: Hardcoded Initial `columnDefinitions` Missing COMPLETED 🟡
The initial `columnDefinitions` array in `kanban.html` (used before first `updateColumns` message) didn't include COMPLETED. Any completed cards arriving before the first backend message would be bucketed into CREATED.

#### NIT-1: `_columnsSignature` Doesn't Include `kind`
Not actionable now — column IDs are unique so new columns always change the signature.

#### NIT-2: `kanbanColumnDerivation.ts` Type Doesn't Include `'COMPLETED'`
Type ends with `| string` so it compiles; cosmetic inconsistency only.

### Fixes Applied

| Finding | Fix | Files Changed |
|---|---|---|
| **CRITICAL-1** | Synced all `.js` files with `.ts` sources; rebuilt webpack bundle | `agentConfig.js`, `KanbanDatabase.js`, `KanbanProvider.js`, `extension.js`, `TaskViewerProvider.js` |
| **CRITICAL-2** | Changed `DEFAULT_CUSTOM_AGENT_KANBAN_ORDER` to exclude `kind: 'completed'` from max calc: `DEFAULT_KANBAN_COLUMNS.filter(c => c.kind !== 'completed').map(c => c.order)` | `agentConfig.ts`, `agentConfig.js` |
| **CRITICAL-3** | Added `await db.updateStatus(sessionId, 'active')` in the `uncompleteCard` handler after successful restore, before backward column move | `KanbanProvider.ts`, `KanbanProvider.js` |
| **MAJOR-1** | Added optimistic DOM relocation with `card-completing` animation for cards dropped to COMPLETED before sending `completePlan` messages | `kanban.html` |
| **MAJOR-2** | Added `{ id: 'COMPLETED', label: 'Completed', kind: 'completed', autobanEnabled: false }` to hardcoded initial `columnDefinitions` array | `kanban.html` |
| **NIT-1** | Deferred | — |
| **NIT-2** | Deferred | — |

### Validation Results

| Check | Result |
|---|---|
| `npx tsc --noEmit` | ✅ Pass — zero errors |
| `npm run compile` (webpack) | ✅ Pass — both bundles compiled successfully |
| `buildKanbanColumns([])` — COMPLETED is last column | ✅ Verified: `COMPLETED (order:9999)` is last |
| `buildKanbanColumns([customAgent])` — custom agent before COMPLETED | ✅ Verified: `custom_agent_myagent (order:400)` before `COMPLETED (order:9999)` |
| `KanbanDatabase.js` — `getCompletedPlans` / `getPlanBySessionId` exist | ✅ Both methods present and typed correctly |
| `KanbanProvider.js` — `completeSelected` / `completeAll` / `uncompleteCard` handlers | ✅ All three handlers synced with TS, including CRITICAL-3 fix |
| `extension.js` — `restorePlanFromKanban` command registered | ✅ Present |
| `TaskViewerProvider.js` — `handleKanbanRestorePlan` method | ✅ Present |
| Standalone tests (ordering, batch-prompt, smart-router) | ✅ All pass |
| Pre-existing test failures (module resolution for `kanbanColumnDerivation`, `out/`) | ⚠️ Pre-existing — not related to this feature |

### Remaining Risks
- **Manual verification needed**: Drag-to-COMPLETED and drag-out-of-COMPLETED flows require manual testing in the VS Code extension host (no automated UI tests for webview drag-and-drop).
- **File-based fallback for completed cards**: Uses `SessionActionLog.getCompletedRunSheets()` which scans active sessions dir. Archived sessions that were moved out of the sessions dir by `_archiveCompletedSession()` are excluded from fallback — the DB is the authoritative source for those.
- **NIT items deferred**: `_columnsSignature` not including `kind`, and `kanbanColumnDerivation.ts` type not listing `'COMPLETED'` explicitly — both are cosmetic and carry no runtime risk.
