# Stop Session Files Being Auto-Created When DB Already Has the Plan

## Goal

The plan file watcher in `TaskViewerProvider` auto-created 118 session `.json` files on a second machine where those files did not previously exist. The `kanban.db` (SQLite via sql.js) is supposed to be the authoritative source of truth for plan state, but the extension's file-watcher pipeline still treats missing session files as "brand new plans" and unconditionally creates them.

The fix must ensure that when a `.md` plan file is detected on a machine that already has the plan recorded in `kanban.db`, **no session file is created**. Session files should only be created for genuinely new plans that have no DB entry whatsoever.

## User Review Required

- **Confirm**: Should the fix also suppress session-file creation in `_mirrorBrainPlan()` for brain-sourced plans that already have a DB entry? (This plan assumes **yes**.)
- **Confirm**: Is `_restoreRunSheet()` (manual archive restore) considered an intentional user action and therefore exempt from the DB guard? (This plan assumes **yes** — restore is intentional.)
- **Confirm**: After suppressing file creation, should `_syncFilesAndRefreshRunSheets()` still be called so the UI stays up-to-date from the DB? (This plan assumes **yes**.)

## Complexity Audit

**Manual Complexity Override:** Low


### Routine

- Adding a DB-existence check before file writes — straightforward conditional guard.
- Adding a new `getPlanByPlanFile(planFile)` query method to `KanbanDatabase` — simple SQL `WHERE plan_file = ?` lookup.
- The changes touch well-isolated code paths with clear call boundaries.

### Complex / Risky
- None.


## Edge-Case & Dependency Audit

1. **Extension startup race**: `_handlePlanCreation()` can fire before `KanbanDatabase._initialize()` completes. Guard: if DB is not ready, fall through to existing file-based logic (no regression).
2. **kanban.db missing entirely** (first-ever machine): No DB entry exists, no session files exist → correctly treated as new plan → file created → synced to DB on next cycle. No change needed.
3. **kanban.db exists but plan was deleted/archived**: `status = 'completed'` or record absent. Guard must treat archived/completed plans as "already known" to avoid resurrection. The DB check should query `WHERE plan_file = ? AND status = 'active'` OR include completed — depends on desired behavior. This plan uses `WHERE plan_file = ?` (any status) to prevent recreation of completed plans.
4. **Plan file renamed/moved**: `plan_file` column stores a relative path. If the user renames the `.md` file, the DB lookup will miss. This is acceptable — renamed plans are effectively new plans and should get new session entries.
5. **Brain plans with `antigravity_` prefix**: `_mirrorBrainPlan()` uses `antigravity_{pathHash}` as the session ID. The DB check should use `session_id` (which includes the prefix) for brain plans, not just `plan_file`, since the mirror path changes.
6. **Concurrent file watcher events**: Both VS Code's `onDidCreate` and the native `fs.watch` fallback may fire for the same file. The existing `_pendingPlanCreations` guard handles this, but the new DB check adds another layer of protection.
7. **Cross-plan conflict**: The "kanban card links do not work" plan (`feature_plan_20260326_135709_kanban_card_links_do_not_work.md`) also deals with DB-vs-file authority. These plans are complementary — that plan fixes link resolution from DB records, this plan prevents spurious file creation. No conflicts.

## Adversarial Synthesis

### Grumpy Critique

Oh wonderful, so we built a shiny SQLite database to be the "single source of truth," gave it a fancy WASM runtime, and then — *checks notes* — left every single file-creation path completely unaware that the database exists? The plan file watcher still does `findRunSheetByPlanFile()` which, I kid you not, **reads JSON files off disk** to decide whether a plan is "new." On a fresh machine with zero session files, every single one of 118 plans looks brand new. Brilliant.

And `_mirrorBrainPlan()`? Even better. It doesn't even bother calling `SessionActionLog` — it raw-dogs `fs.promises.writeFile()` directly onto the filesystem like it's 2019 and we've never heard of a database. We have `KanbanDatabase.hasPlan(sessionId)` sitting right there, gathering dust, while the extension gleefully vomits 118 session files onto a machine that doesn't need them.

The fix itself is trivial — add a DB lookup before every `writeFile` — but I'm deeply skeptical that anyone has thought through the startup race condition. What happens when the plan watcher fires at millisecond 200 and the sql.js WASM binary hasn't even finished loading? You'll get a null DB reference, fall through to the file-based check, find nothing, and create the file anyway. The 118-file problem comes right back. If you're going to add a guard, you need to handle the "DB not ready yet" case explicitly — either by deferring the watcher events or by queuing them until the DB is initialized.

Also, `getPlanByPlanFile()` doesn't exist yet. You'll need to add it. And you'd better normalize the plan_file path the same way `_normalizePlanFilePath()` does, or you'll get false negatives on Windows vs. POSIX path separators.

### Balanced Response

The critique correctly identifies the root cause: the deduplication check in `_handlePlanCreation()` uses `findRunSheetByPlanFile()`, which only searches session files on disk. On a fresh machine, there are no session files, so every plan appears new — regardless of what the DB says. The fix is indeed straightforward (add DB lookups), but the startup race condition is a genuine concern.

**Mitigations for raised concerns:**

1. **Startup race**: The `KanbanDatabase.ensureReady()` method returns `false` if the DB isn't initialized. The guard will check `db.ensureReady()` first and, if not ready, fall through to the existing file-based logic. This means during early startup, the old behavior applies (which is no worse than today). Once the DB is ready, the guard kicks in and prevents spurious file creation. This is safe because the plan watcher typically fires after workspace activation, by which point the DB is loaded.

2. **Path normalization**: The new `getPlanByPlanFile()` method will normalize forward slashes before querying, consistent with how `plan_file` is stored in the DB (the `_buildKanbanRecordFromSheet` method already normalizes to forward slashes).

3. **Direct writes in `_mirrorBrainPlan()`**: For brain plans, we can use the existing `hasPlan(sessionId)` since the session ID is deterministic (`antigravity_{pathHash}`). No need for a plan_file lookup here.

4. **No regression path**: If the DB check fails for any reason (DB not ready, corrupt, query error), the code falls through to existing behavior. The worst case is the status quo (files get created), not a new failure mode.

## Proposed Changes

### KanbanDatabase — Add plan_file lookup method

#### MODIFY `src/services/KanbanDatabase.ts`

- **Context:** `KanbanDatabase` has `hasPlan(sessionId)` and `getPlanBySessionId(sessionId)` but no way to look up a plan by its `plan_file` column. The dedup logic in `_handlePlanCreation()` needs to check if a plan_file already exists in the DB.
- **Logic:** Add `getPlanByPlanFile(planFile: string, workspaceId: string)` that queries `SELECT ... FROM plans WHERE plan_file = ? AND workspace_id = ?`. Normalize the plan_file to forward slashes before querying, since the DB stores POSIX-style paths.
- **Implementation:**
  ```typescript
  public async getPlanByPlanFile(planFile: string, workspaceId: string): Promise<KanbanPlanRecord | null> {
      if (!(await this.ensureReady()) || !this._db) return null;
      const normalized = planFile.replace(/\\/g, '/');
      const stmt = this._db.prepare(
          `SELECT ${PLAN_COLUMNS} FROM plans WHERE plan_file = ? AND workspace_id = ? LIMIT 1`,
          [normalized, workspaceId]
      );
      const rows = this._readRows(stmt);
      return rows.length > 0 ? rows[0] : null;
  }
  ```
- **Edge Cases Handled:** Returns `null` if DB not ready (falls through to file-based check). Normalizes backslashes. Scoped to workspace to avoid cross-workspace collisions.

### TaskViewerProvider — Guard `_handlePlanCreation()` with DB check

#### MODIFY `src/TaskViewerProvider.ts`

- **Context:** `_handlePlanCreation()` (lines 5302-5402) is triggered by the plan file watcher when a `.md` file appears in `.switchboard/plans/`. It checks `findRunSheetByPlanFile()` (file-based) to see if a runsheet already exists. On a fresh machine with no session files but a populated `kanban.db`, this check returns `null`, causing 118 spurious file creates.
- **Logic:** After the existing `findRunSheetByPlanFile()` check (line 5320-5326), add a secondary check against `KanbanDatabase`. If the DB has an entry for this plan_file (any status), skip session file creation and call `_syncFilesAndRefreshRunSheets()` to ensure the UI is up-to-date.
- **Implementation:** Insert the following block immediately after the existing `existingForPlan` check (after line 5326):
  ```typescript
  // DB-level dedup: if kanban.db already knows about this plan, do not create a session file.
  // This prevents spurious file creation on machines that have the DB but not the session files.
  const db = await this._getKanbanDb(resolvedWorkspaceRoot);
  if (db) {
      const workspaceId = this._workspaceId || await this._getOrCreateWorkspaceId(resolvedWorkspaceRoot);
      const dbEntry = await db.getPlanByPlanFile(normalizedPlanFileRelative, workspaceId);
      if (dbEntry) {
          console.log(`[TaskViewerProvider] Plan already in DB (session: ${dbEntry.sessionId}), skipping file creation for: ${normalizedPlanFileRelative}`);
          await this._syncFilesAndRefreshRunSheets(resolvedWorkspaceRoot);
          return;
      }
  }
  ```
- **Edge Cases Handled:**
  - DB not ready at startup: `_getKanbanDb()` returns `null` → guard is skipped → falls through to existing file-based logic (no regression).
  - DB query fails: `getPlanByPlanFile` returns `null` → same fallthrough.
  - Plan was completed/archived in DB: Still has an entry → guard fires → no resurrection of session file.
  - Plan genuinely new: No DB entry → guard passes → file created as before.

### TaskViewerProvider — Guard `_mirrorBrainPlan()` with DB check

#### MODIFY `src/TaskViewerProvider.ts`

- **Context:** `_mirrorBrainPlan()` (lines 5142-5300) mirrors brain plans and creates session files via direct `fs.promises.writeFile()`. It uses the deterministic session ID `antigravity_{pathHash}`. On a fresh machine, it creates session files for every brain plan even if they're already in the DB.
- **Logic:** After the existing dedup checks (blacklist, archive, tombstone, mtime) and before the runsheet write (around line 5266), add a DB check using `hasPlan(runSheetId)`. If the plan already exists in the DB, skip the session file write but still update the mirror `.md` file (since the mirror content may need refreshing).
- **Implementation:** Insert before the runsheet JSON write block (before line 5266, after the mirror `.md` file write):
  ```typescript
  // DB-level dedup: if this brain plan's session already exists in kanban.db,
  // skip session file creation. The mirror .md is still written (content may differ),
  // but we don't need a new .json runsheet.
  const db = await this._getKanbanDb(resolvedWorkspaceRoot);
  if (db) {
      const alreadyInDb = await db.hasPlan(runSheetId);
      if (alreadyInDb) {
          console.log(`[TaskViewerProvider] Brain plan already in DB (session: ${runSheetId}), skipping runsheet file creation`);
          await this._syncFilesAndRefreshRunSheets(resolvedWorkspaceRoot);
          return;
      }
  }
  ```
- **Edge Cases Handled:**
  - DB not ready: `_getKanbanDb()` returns `null` → falls through → existing behavior.
  - Brain plan genuinely new: `hasPlan()` returns `false` → file created as before.
  - Brain plan completed/archived: `hasPlan()` still returns `true` (it checks any status via `SELECT 1 FROM plans WHERE session_id = ?`) → no resurrection.
  - Mirror `.md` content refresh: The mirror file write happens before this guard, so content stays up-to-date even when the runsheet write is skipped.

### SessionActionLog — No changes needed

#### (No modification to `src/services/SessionActionLog.ts`)

- **Context:** `SessionActionLog.createRunSheet()` and `updateRunSheet()` are low-level file I/O methods. They don't have access to `KanbanDatabase` and shouldn't — they're called by higher-level code that should perform the guard checks.
- **Logic:** The guards are placed at the caller level (`_handlePlanCreation`, `_mirrorBrainPlan`) rather than inside `SessionActionLog`. This preserves the single-responsibility of `SessionActionLog` (file I/O) and avoids circular dependencies.
- **Edge Cases Handled:** N/A — no changes.

### _restoreRunSheet — No changes needed

#### (No modification to `_restoreRunSheet()`)

- **Context:** `_restoreRunSheet()` is triggered by an explicit user action (clicking "Restore" on an archived plan). It intentionally creates/overwrites a session file to bring an archived plan back to active state.
- **Logic:** This is a deliberate user action, not an automated watcher. Suppressing it would break the restore feature.
- **Edge Cases Handled:** N/A — intentional behavior, exempt from the DB guard.

## Verification Plan

### Automated Tests

1. **Unit test for `KanbanDatabase.getPlanByPlanFile()`**:
   - Insert a plan with `plan_file = '.switchboard/plans/test.md'` and `workspace_id = 'ws1'`.
   - Assert `getPlanByPlanFile('.switchboard/plans/test.md', 'ws1')` returns the record.
   - Assert `getPlanByPlanFile('.switchboard/plans/test.md', 'ws2')` returns `null` (wrong workspace).
   - Assert `getPlanByPlanFile('.switchboard\\plans\\test.md', 'ws1')` returns the record (backslash normalization).
   - Assert `getPlanByPlanFile('.switchboard/plans/other.md', 'ws1')` returns `null` (wrong path).

2. **Unit test for `_handlePlanCreation()` DB guard**:
   - Mock `KanbanDatabase.getPlanByPlanFile()` to return a plan record.
   - Trigger `_handlePlanCreation()` with a plan file URI.
   - Assert `SessionActionLog.createRunSheet()` is **not** called.
   - Assert `_syncFilesAndRefreshRunSheets()` **is** called (UI refresh).

3. **Unit test for `_mirrorBrainPlan()` DB guard**:
   - Mock `KanbanDatabase.hasPlan()` to return `true`.
   - Trigger `_mirrorBrainPlan()` with a brain plan path.
   - Assert `fs.promises.writeFile()` is **not** called for the `.json` runsheet path.
   - Assert `fs.promises.writeFile()` **is** called for the mirror `.md` path (content still updated).

4. **Integration test: fresh machine scenario**:
   - Set up a workspace with a populated `kanban.db` containing 5 plan records.
   - Ensure `.switchboard/sessions/` directory is empty (no session files).
   - Create 5 `.md` files in `.switchboard/plans/` matching the DB records' `plan_file` paths.
   - Assert: no new `.json` files appear in `.switchboard/sessions/`.
   - Assert: the kanban board UI still renders all 5 plans from the DB.

### Manual Tests

1. **Reproduce the 118-file bug**:
   - Take a workspace with a populated `kanban.db` and delete all files in `.switchboard/sessions/`.
   - Open the workspace in VS Code with the extension.
   - Verify: no new session files are created in `.switchboard/sessions/`.
   - Verify: the kanban board still shows all plans.

2. **Genuine new plan creation still works**:
   - With the fix applied, create a brand new plan via the extension's "New Plan" flow.
   - Verify: a session file IS created (since the plan has no DB entry yet).
   - Verify: the plan appears on the kanban board.

3. **Brain plan mirroring on fresh machine**:
   - Set up a brain directory with `.md` plan files that are already in `kanban.db`.
   - Delete all session files.
   - Trigger the brain mirror watcher.
   - Verify: mirror `.md` files are created/updated, but no `.json` runsheet files appear.

4. **Restore from archive still works**:
   - Archive a plan.
   - Click "Restore."
   - Verify: the session file is recreated and the plan reappears on the board.

5. **Startup race condition**:
   - Add a 5-second artificial delay to `KanbanDatabase._initialize()`.
   - Open a workspace with plans.
   - Verify: if plan watcher fires before DB is ready, behavior is same as before (files created, synced to DB later). No crash, no data loss.

## Recommendation

**Send to Coder** — The changes are surgical (one new DB method, two guard insertions at caller sites), the architecture is well-understood, and the fallback behavior ensures no regressions. No schema migrations needed. The `hasPlan()` and new `getPlanByPlanFile()` methods are simple SQL queries.
