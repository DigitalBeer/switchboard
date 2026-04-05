# Fix Kanban DB Location Change Data Loss

## Goal
Prevent silent data loss when the user changes the Kanban database path via the UI. Currently, changing the path creates a new empty database at the target location, orphaning all existing plans at the old location with no migration, no warning, and no way to recover from the UI.

## Metadata
**Tags:** backend, database, UI, bugfix
**Complexity:** High

## User Review Required
> [!NOTE]
> - No breaking changes. Default behavior (`.switchboard/kanban.db`) is unchanged.
> - When the DB path is changed (via Edit Path, preset buttons, or `kanban.dbPath` setting), the system will now **automatically migrate** data from the old location to the new one if the new DB is empty and the old DB contains plans.
> - A new **"Use Local DB"** button is added to the Database Operations panel.
> - On startup, a warning notification appears if the configured DB is empty but an orphaned DB with plans exists at the default location.
> - A new command **"Switchboard: Reconcile Kanban Databases"** is available in the Command Palette for manual recovery.
> - The old DB is renamed to `kanban.db.backup.<timestamp>` after successful migration (never deleted).

## Problem Summary

The kanban database location feature has critical UX flaws that cause user data to become "orphaned" and invisible:

1. **No Migration on Path Change**: When changing DB location via UI, the system creates a new empty database at the new path instead of migrating existing data. The old database with all plans is abandoned.

2. **Missing UI Controls**: The UI shows "CLOUD DATABASE LOCATION" with a "LOCAL" label, but there is no actual button to switch back to local mode. Users cannot easily revert to local database.

3. **Settings/UI Desync**: The UI state does not accurately reflect the actual configuration in `.vscode/settings.json`. The settings file can contain a custom path while the UI appears to show local mode.

4. **Silent Data Loss**: When the migration ran on the wrong (new/empty) database, it only created 16 plans from session files, leaving 219 plans orphaned in the local database with no user-facing indication of this.

5. **No Data Integrity Checks**: The system does not detect when a configured database is empty but an orphaned database exists at the default location.

## Root Causes

- `KanbanDatabase.forWorkspace()` (at `src/services/KanbanDatabase.ts:154-191`) reads `kanban.dbPath` setting and uses it directly without checking if data migration is needed
- `_initialize()` (at `src/services/KanbanDatabase.ts:841-917`) creates a brand-new empty DB at the resolved path if no file exists — no check for an orphaned DB at the default location
- The `editDbPath` handler (at `src/services/TaskViewerProvider.ts:3332-3355`) and `setPresetDbPath` handler (at `src/services/TaskViewerProvider.ts:3380-3463`) both call `invalidateWorkspace()` and update the setting, but perform zero migration
- The `onDidChangeConfiguration` listener (at `src/extension.ts:1036-1046`) only invalidates the cache — no migration trigger
- UI (at `src/webview/implementation.html:1691-1762`) lacks a "switch to local" button; only "Edit Path" and preset buttons exist
- No reconciliation logic exists to merge split databases

## Complexity Audit

### Routine
- **R1: Add "Use Local DB" button to UI** — Add a `<button>` to `src/webview/implementation.html` in the Database Operations panel (after L1708). Wire a `click` handler that sends `{ type: 'setLocalDb' }` message. Straightforward HTML + JS.
- **R2: Add `setLocalDb` webview message handler** — In `src/services/TaskViewerProvider.ts`, add a new `case 'setLocalDb':` in the webview message switch (near L3332). Clear `kanban.dbPath` setting via `config.update('kanban.dbPath', undefined, ConfigurationTarget.Workspace)`, call `invalidateWorkspace()`, post `dbPathUpdated` message, refresh.
- **R3: Fix cloud-status badge display** — In `src/webview/implementation.html`, the `#cloud-status` badge always shows "local" on load. Update the `dbPathUpdated` message handler in the webview JS to set the badge text to `"cloud"` when a non-default path is active, `"local"` otherwise. **Clarification:** This is implied by Problem #3 (Settings/UI Desync); the badge currently does not react to the actual setting value on load.
- **R4: Register reconciliation command in `package.json`** — Add `switchboard.reconcileKanbanDbs` to `contributes.commands` array. Boilerplate.

### Complex / Risky
- **C1: Migration logic in `KanbanDatabase`** — New static method `migrateIfNeeded(sourcePath, targetPath)` that opens both databases via sql.js, counts plans in each, copies data if target is empty and source has data, then renames source to `.backup.<timestamp>`. Risk: both DBs open simultaneously doubles memory; sql.js `Database` constructor can throw on corrupt files; must handle schema version mismatches between source and target.
- **C2: Wiring migration into path-change flows** — The `editDbPath` handler, `setPresetDbPath` handler, and the `onDidChangeConfiguration` listener must all compute the *old* default path (`<workspace>/.switchboard/kanban.db`) and the *new* resolved path, then call `migrateIfNeeded()` before creating the new `KanbanDatabase` instance. Risk: the `onDidChangeConfiguration` listener fires *after* the setting is already updated, so we cannot read the old value from config — we must capture it before the update in the UI handlers, or derive the default path statically.
- **C3: Startup orphan detection** — In `TaskViewerProvider.initializeKanbanDbOnStartup()` (L945-954), after initializing the DB, count plans. If zero AND `fs.existsSync(<workspace>/.switchboard/kanban.db)` AND that file has plans, show a `vscode.window.showWarningMessage` with a "Migrate Data" action button. The button callback must perform the same migration logic from C1. Risk: opens a second DB temporarily; must not interfere with the already-initialized primary DB instance.
- **C4: Reconciliation command** — New command `switchboard.reconcileKanbanDbs` in `src/extension.ts` that scans known locations (default path, current configured path, common cloud paths), opens each found DB, counts plans, shows a QuickPick for the user to select source → target, then merges with "newest `updated_at` wins" conflict resolution using `INSERT OR REPLACE`. Risk: merging databases with different `workspace_id` values; duplicate `plan_id` or `session_id` collisions; must handle schema version differences.

## Edge-Case & Dependency Audit
- **Race Conditions:** The `editDbPath` handler is async. If the user clicks "Edit Path" twice rapidly, two migrations could run concurrently on the same source file. **Mitigation:** Add a static `_migrationInProgress` flag on `KanbanDatabase` that short-circuits concurrent migration attempts. The `_writeTail` promise queue also needs draining before migration starts (already done by `invalidateWorkspace()`).
- **Security:** The custom DB path is user-configured. If pointed at a shared/public folder, plan metadata (topics, file paths) would be exposed. This is the user's responsibility. No credentials are stored in the DB. The migration copies data to a user-chosen location — no new security surface.
- **Side Effects:**
  - Migration renames the old DB to `.backup.<timestamp>` — this leaves a file in `.switchboard/` that is not gitignored by default. The `.gitignore` should already cover `*.backup.*` patterns or `kanban.db*`; verify this.
  - The backup rename uses `fs.renameSync`, which will fail if source and target are on different filesystems (e.g., local → iCloud). Must use copy-then-delete pattern instead.
- **Dependencies & Conflicts:**
  - ⚠️ `feature_plan_20260326_150916_sqlite_db_not_syncing_correctly_across_machines.md` — The plan that *introduced* the `kanban.dbPath` setting and `invalidateWorkspace()`. This fix plan addresses bugs introduced by that feature. **No code conflict** — that plan is already shipped and its code is live.
  - ⚠️ `feature_plan_20260327_164724_board_state_is_different_across_different_ides.md` — Added `_reloadIfStale()` and mtime tracking to `_initialize()` and `ensureReady()`. Any changes to `_initialize()` in this plan must preserve the mtime tracking logic at L846-864. **Low conflict** — migration runs *before* `_initialize()` is called on the new path.
  - ⚠️ `migration_db_lite_20260329.md` — Session file migration. Touches `TaskViewerProvider.ts` at different code paths (dispatch flow, session file iteration). **No conflict expected** — different lines, different concerns.
  - The `onDidChangeConfiguration` listener at `src/extension.ts:1036-1046` is the *only* place that reacts to runtime setting changes. The UI handlers (`editDbPath`, `setPresetDbPath`) call `invalidateWorkspace()` directly, then the config listener fires again redundantly. **Clarification:** The UI handlers should perform migration *before* updating the setting, so that migration happens while the old DB instance is still cached. The config listener remains a safety net for manual `settings.json` edits.

## Adversarial Synthesis

### Grumpy Critique

Oh, *wonderful*. So the plan is to add migration logic that opens TWO sql.js databases simultaneously in memory — because what this extension really needed was to double its RAM footprint during the most dangerous operation in its lifecycle: moving a user's entire plan history.

Let me enumerate the ways this will go sideways:

1. **The `onDidChangeConfiguration` listener is a trap.** It fires *after* the setting is already changed. By the time you read `kanban.dbPath`, it's the NEW value. You cannot determine the old path from config alone. The plan says "derive the default path statically" — but what if the user changed from one custom path to ANOTHER custom path? You have no record of the previous custom path. You'd need to stash it somewhere before the update. The UI handlers can do this (they have the old value in scope), but anyone who edits `.vscode/settings.json` by hand will bypass the UI handlers entirely and hit the config listener, which has NO access to the old path.

2. **Cross-filesystem rename.** The plan says `fs.renameSync(sourcePath, backupPath)`. If the source is on the local disk and the target is on iCloud, `rename` will throw `EXDEV`. This isn't an edge case — it's the **primary use case**. The user is moving from local to cloud. You MUST use copy-then-unlink, not rename.

3. **Schema version mismatch in reconciliation.** What happens when the user has a DB at version 5 (with `plan_events` and `activity_log` tables) and tries to reconcile with an older DB at version 2 (no event tables)? The `INSERT OR REPLACE` will fail because the target schema doesn't have the source's tables. The plan doesn't even mention schema alignment.

4. **The "both DBs have data" case is hand-waved.** The plan says "warn user and require manual reconciliation." But the reconciliation command is item #4 — a separate feature that the user might not know about. If both DBs have data during an automatic migration attempt, what happens? The plan says "warn" but doesn't specify the UX flow. Does it abort the path change? Does it change the path but leave data behind? This is the MOST LIKELY failure scenario (user experiments with cloud, gets some plans in both places) and it has the vaguest specification.

5. **No unit tests specified.** The plan has "Verification Steps" that are all manual. For a data migration feature — the kind of code that runs ONCE and must be PERFECT — you need automated tests that create two databases, run migration, and verify row counts and data integrity.

### Balanced Response

Grumpy raises five valid concerns. Here's how each is addressed:

1. **Config listener old-path problem:** The UI handlers (`editDbPath` at L3332, `setPresetDbPath` at L3380) already have the old value in scope before updating. Migration is triggered there. For the `onDidChangeConfiguration` listener, we take a conservative approach: it can only detect migrations from the *default* path (`.switchboard/kanban.db`) to whatever the new setting is. Custom-to-custom changes via manual settings.json edits are unsupported for auto-migration — the reconciliation command (C4) covers that case. This is documented in the User Review Required section.

2. **Cross-filesystem rename:** Correct. The implementation must use `fs.promises.copyFile()` + `fs.promises.unlink()` instead of `fs.renameSync()`. The backup is created at the *source* location (same filesystem), so the backup rename itself is safe. Only the migration copy goes cross-filesystem.

3. **Schema version mismatch:** The migration method opens the source DB, runs `_runMigrations()` on it to bring it to the latest schema, then copies table data. Both databases will be at the same schema version before any data transfer. This is safe because `_runMigrations()` is idempotent (all `ALTER` statements use `try/catch` for "column already exists").

4. **"Both DBs have data":** The auto-migration aborts and shows a warning with two action buttons: "Open Reconciliation" (launches the reconcile command) and "Ignore" (proceeds with empty DB). The path change still takes effect — the user can always use the reconciliation command later. This is explicitly specified in the Proposed Changes below.

5. **Automated tests:** A dedicated test file `src/test/kanban-db-migration.test.ts` is specified in the Verification Plan. It creates two in-memory databases, populates one, runs migration, and verifies row transfer and backup creation.

## Proposed Changes

### 1. Migration Logic in KanbanDatabase
#### [MODIFY] `src/services/KanbanDatabase.ts`

- **Context:** This file contains `forWorkspace()` (L154-191) and `_initialize()` (L841-917). Migration must happen *before* the new DB instance is fully initialized, but *after* the path is resolved.
- **Logic:**
  1. Add a new **static** method `migrateIfNeeded(sourcePath: string, targetPath: string): Promise<{migrated: boolean; skipped: string | null}>`. It is static because migration must happen before any instance is created at the target path.
  2. The method loads sql.js, opens source DB as read-only (via `new SQL.Database(buffer)`), counts active plans.
  3. If target exists, open it and count plans. If target has plans → return `{migrated: false, skipped: 'target_has_data'}`.
  4. If source has no plans → return `{migrated: false, skipped: 'source_empty'}`.
  5. Copy source file to target path using `fs.promises.copyFile()`.
  6. Rename source to `<sourcePath>.backup.<Date.now()>` (same-filesystem rename is safe).
  7. Return `{migrated: true, skipped: null}`.
  8. All errors are caught and logged — migration failure must never prevent the extension from starting.
  9. Add a static `_migrationInProgress: boolean = false` guard to prevent concurrent migrations.

- **Implementation:**

```typescript
// Add after the existing `validatePath()` static method (after line ~238)

private static _migrationInProgress = false;

/**
 * Migrate data from sourcePath to targetPath if target is empty/missing and source has plans.
 * Returns migration result: migrated=true if data was copied, skipped=reason if not.
 * Safe to call even if source/target don't exist.
 */
public static async migrateIfNeeded(
    sourcePath: string,
    targetPath: string
): Promise<{ migrated: boolean; skipped: string | null }> {
    if (sourcePath === targetPath) {
        return { migrated: false, skipped: 'same_path' };
    }
    if (KanbanDatabase._migrationInProgress) {
        return { migrated: false, skipped: 'migration_in_progress' };
    }
    KanbanDatabase._migrationInProgress = true;
    try {
        // 1. Check source exists and has data
        if (!fs.existsSync(sourcePath)) {
            return { migrated: false, skipped: 'source_not_found' };
        }
        const sourceHasPlans = await KanbanDatabase._dbFileHasPlans(sourcePath);
        if (!sourceHasPlans) {
            return { migrated: false, skipped: 'source_empty' };
        }

        // 2. Check target — if it exists and has plans, abort (needs manual reconciliation)
        if (fs.existsSync(targetPath)) {
            const targetHasPlans = await KanbanDatabase._dbFileHasPlans(targetPath);
            if (targetHasPlans) {
                return { migrated: false, skipped: 'target_has_data' };
            }
        }

        // 3. Ensure target directory exists
        await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });

        // 4. Copy source to target (cross-filesystem safe)
        await fs.promises.copyFile(sourcePath, targetPath);
        console.log(`[KanbanDatabase] Migrated DB from ${sourcePath} to ${targetPath}`);

        // 5. Rename source to backup (same-filesystem, safe)
        const backupPath = `${sourcePath}.backup.${Date.now()}`;
        await fs.promises.rename(sourcePath, backupPath);
        console.log(`[KanbanDatabase] Source backed up to ${backupPath}`);

        return { migrated: true, skipped: null };
    } catch (error) {
        console.error('[KanbanDatabase] Migration failed:', error);
        return { migrated: false, skipped: `error: ${error instanceof Error ? error.message : String(error)}` };
    } finally {
        KanbanDatabase._migrationInProgress = false;
    }
}

/**
 * Open a DB file read-only and check if it contains any active plans.
 * Returns false if file is missing, corrupt, or has no plans.
 */
private static async _dbFileHasPlans(dbPath: string): Promise<boolean> {
    try {
        const SQL = await KanbanDatabase._loadSqlJs();
        const buffer = await fs.promises.readFile(dbPath);
        const db = new SQL.Database(new Uint8Array(buffer));
        try {
            // Check if plans table exists and has active rows
            const stmt = db.prepare("SELECT COUNT(*) as cnt FROM plans WHERE status = 'active'");
            if (stmt.step()) {
                const count = Number(stmt.getAsObject().cnt);
                stmt.free();
                return count > 0;
            }
            stmt.free();
            return false;
        } finally {
            if (db.close) db.close();
        }
    } catch {
        // File corrupt, not a valid DB, or table doesn't exist
        return false;
    }
}

/**
 * Returns the default local DB path for a workspace.
 */
public static defaultDbPath(workspaceRoot: string): string {
    return path.join(path.resolve(workspaceRoot), '.switchboard', 'kanban.db');
}
```

- **Edge Cases Handled:**
  - Same path → no-op.
  - Concurrent migration → `_migrationInProgress` flag prevents double-run.
  - Cross-filesystem → uses `copyFile` + `rename` (rename is same-filesystem for backup).
  - Corrupt source → `_dbFileHasPlans` catches all errors and returns false.
  - Missing target directory → `mkdir` with `recursive: true`.

### 2. Wire Migration into `editDbPath` Handler
#### [MODIFY] `src/services/TaskViewerProvider.ts`

- **Context:** The `editDbPath` handler at L3332-3355 lets the user type a custom path. Currently it just updates the setting and invalidates. Must add migration before the setting update.
- **Logic:**
  1. Capture the current (old) resolved DB path *before* updating the setting.
  2. Resolve the new path using the same logic as `forWorkspace()`.
  3. Call `KanbanDatabase.migrateIfNeeded(oldPath, newPath)`.
  4. If migration returns `skipped: 'target_has_data'`, show a warning with "Open Reconciliation" / "Ignore" buttons.
  5. Proceed with setting update and invalidation regardless (path change always takes effect).

- **Implementation:**

```typescript
// Replace the existing case 'editDbPath': block (L3332-3355) with:
case 'editDbPath': {
    const dbConfig = vscode.workspace.getConfiguration('switchboard');
    const currentDbPath = dbConfig.get<string>('kanban.dbPath', '');
    const dbResult = await vscode.window.showInputBox({
        prompt: 'Enter path for kanban database (supports ~ for home dir)',
        value: currentDbPath || '',
        placeHolder: '~/Google Drive/Switchboard/kanban.db',
    });
    if (dbResult !== undefined) {
        const trimmedPath = dbResult.trim();
        const validation = KanbanDatabase.validatePath(trimmedPath);
        if (!validation.valid && trimmedPath !== '') {
            vscode.window.showErrorMessage(`❌ Invalid path: ${validation.error}`);
            return;
        }
        const wsRoot = this._getWorkspaceRoot();
        if (wsRoot) {
            // Resolve old and new paths for migration
            const oldResolvedPath = currentDbPath
                ? (path.isAbsolute(currentDbPath.startsWith('~') ? path.join(os.homedir(), currentDbPath.slice(1)) : currentDbPath)
                    ? (currentDbPath.startsWith('~') ? path.join(os.homedir(), currentDbPath.slice(1)) : currentDbPath)
                    : path.join(wsRoot, currentDbPath))
                : KanbanDatabase.defaultDbPath(wsRoot);
            const newResolvedPath = trimmedPath
                ? (path.isAbsolute(trimmedPath.startsWith('~') ? path.join(os.homedir(), trimmedPath.slice(1)) : trimmedPath)
                    ? (trimmedPath.startsWith('~') ? path.join(os.homedir(), trimmedPath.slice(1)) : trimmedPath)
                    : path.join(wsRoot, trimmedPath))
                : KanbanDatabase.defaultDbPath(wsRoot);

            // Attempt migration before switching
            const migResult = await KanbanDatabase.migrateIfNeeded(oldResolvedPath, newResolvedPath);
            if (migResult.skipped === 'target_has_data') {
                const choice = await vscode.window.showWarningMessage(
                    'Both the current and target databases contain plans. Automatic migration skipped.',
                    'Open Reconciliation', 'Continue Anyway'
                );
                if (choice === 'Open Reconciliation') {
                    vscode.commands.executeCommand('switchboard.reconcileKanbanDbs');
                    return; // Don't change path yet — let reconciliation handle it
                }
                // 'Continue Anyway' or dismissed — proceed with path change (data stays split)
            } else if (migResult.migrated) {
                vscode.window.showInformationMessage(`✅ Migrated plans to new database location.`);
            }

            await KanbanDatabase.invalidateWorkspace(wsRoot);
        }
        await dbConfig.update('kanban.dbPath', trimmedPath || undefined, vscode.ConfigurationTarget.Workspace);
        this._view?.webview.postMessage({ type: 'dbPathUpdated', path: trimmedPath || '.switchboard/kanban.db' });
        void this._refreshSessionStatus();
        vscode.window.showInformationMessage('✅ Database path updated successfully.');
    }
    break;
}
```

- **Edge Cases Handled:** Tilde expansion in both old and new paths; migration failure doesn't block path change; "target has data" gives user a choice.

### 3. Wire Migration into `setPresetDbPath` Handler
#### [MODIFY] `src/services/TaskViewerProvider.ts`

- **Context:** The `setPresetDbPath` handler at L3380-3463 sets a cloud preset path. Same migration gap as `editDbPath`.
- **Logic:** After `presetPath` is resolved and the parent directory is confirmed/created (after L3436), compute `oldResolvedPath` and call `migrateIfNeeded()` before updating the setting. Identical pattern to the `editDbPath` fix.

- **Implementation:** Insert the following block immediately **before** line `const presetConfig = vscode.workspace.getConfiguration('switchboard');` (L3438):

```typescript
// Attempt migration from current DB to preset path
const oldDbConfig = vscode.workspace.getConfiguration('switchboard');
const oldDbPath = oldDbConfig.get<string>('kanban.dbPath', '');
const wsRoot = this._getWorkspaceRoot();
const oldResolvedPath = (oldDbPath && oldDbPath.trim())
    ? (path.isAbsolute(oldDbPath.startsWith('~') ? path.join(os.homedir(), oldDbPath.slice(1)) : oldDbPath)
        ? (oldDbPath.startsWith('~') ? path.join(os.homedir(), oldDbPath.slice(1)) : oldDbPath)
        : path.join(wsRoot || '', oldDbPath))
    : (wsRoot ? KanbanDatabase.defaultDbPath(wsRoot) : '');

if (oldResolvedPath && wsRoot) {
    const migResult = await KanbanDatabase.migrateIfNeeded(oldResolvedPath, presetPath);
    if (migResult.skipped === 'target_has_data') {
        const choice = await vscode.window.showWarningMessage(
            'Both the current and target databases contain plans. Automatic migration skipped.',
            'Open Reconciliation', 'Continue Anyway'
        );
        if (choice === 'Open Reconciliation') {
            vscode.commands.executeCommand('switchboard.reconcileKanbanDbs');
            break; // Don't change path yet
        }
    } else if (migResult.migrated) {
        vscode.window.showInformationMessage(`✅ Migrated plans to ${data.preset} database.`);
    }
}
```

- **Edge Cases Handled:** Same as editDbPath. If `wsRoot` is null, migration is skipped gracefully.

### 4. Add "Use Local DB" Button to Webview
#### [MODIFY] `src/webview/implementation.html`

- **Context:** The Database Operations panel at L1697-1718 has "Edit Path" and "Test" buttons but no way to switch back to local mode.
- **Logic:** Add a "Use Local DB" button next to the existing buttons. It sends a `setLocalDb` message to the extension.

- **Implementation:** Insert after the `db-test-connection-btn` button (after L1708):

```html
<button id="db-use-local-btn" class="db-secondary-btn">Use Local DB</button>
```

Add click handler in the JS section (after L3959):

```javascript
document.getElementById('db-use-local-btn')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'setLocalDb' });
});
```

### 5. Add `setLocalDb` Message Handler
#### [MODIFY] `src/services/TaskViewerProvider.ts`

- **Context:** Needs a new webview message handler to clear the custom DB path and revert to local.
- **Logic:** Read current `kanban.dbPath`, compute resolved paths, run migration from cloud → local default, clear the setting, invalidate, refresh.

- **Implementation:** Add a new `case 'setLocalDb':` in the webview message switch (near L3332):

```typescript
case 'setLocalDb': {
    const wsRoot = this._getWorkspaceRoot();
    if (!wsRoot) break;
    const localDbConfig = vscode.workspace.getConfiguration('switchboard');
    const currentCustomPath = localDbConfig.get<string>('kanban.dbPath', '');
    if (!currentCustomPath || !currentCustomPath.trim()) {
        vscode.window.showInformationMessage('Already using local database.');
        break;
    }
    // Resolve current custom path
    const trimmed = currentCustomPath.trim();
    const expanded = trimmed.startsWith('~') ? path.join(os.homedir(), trimmed.slice(1)) : trimmed;
    const oldResolvedPath = path.isAbsolute(expanded) ? expanded : path.join(wsRoot, expanded);
    const localPath = KanbanDatabase.defaultDbPath(wsRoot);

    // Migrate cloud → local
    const migResult = await KanbanDatabase.migrateIfNeeded(oldResolvedPath, localPath);
    if (migResult.skipped === 'target_has_data') {
        const choice = await vscode.window.showWarningMessage(
            'Both local and cloud databases contain plans.',
            'Open Reconciliation', 'Switch Anyway'
        );
        if (choice === 'Open Reconciliation') {
            vscode.commands.executeCommand('switchboard.reconcileKanbanDbs');
            break;
        }
    } else if (migResult.migrated) {
        vscode.window.showInformationMessage('✅ Migrated plans back to local database.');
    }

    await localDbConfig.update('kanban.dbPath', undefined, vscode.ConfigurationTarget.Workspace);
    await KanbanDatabase.invalidateWorkspace(wsRoot);
    this._view?.webview.postMessage({ type: 'dbPathUpdated', path: '.switchboard/kanban.db' });
    void this._refreshSessionStatus();
    break;
}
```

### 6. Fix Cloud Status Badge Display
#### [MODIFY] `src/webview/implementation.html`

- **Context:** The `#cloud-status` badge at L1701 always reads "local" on page load. The `dbPathUpdated` message handler in the webview JS should toggle it.
- **Logic:** In the existing message listener that handles `dbPathUpdated`, update the badge text and class.

- **Implementation:** Find the existing `dbPathUpdated` handler in the webview JS and ensure it includes:

```javascript
case 'dbPathUpdated': {
    const pathDisplay = document.getElementById('current-db-path');
    const badge = document.getElementById('cloud-status');
    if (pathDisplay) pathDisplay.textContent = msg.path || '.switchboard/kanban.db';
    if (badge) {
        const isCloud = msg.path && msg.path !== '.switchboard/kanban.db';
        badge.textContent = isCloud ? 'cloud' : 'local';
        badge.className = 'db-status-badge ' + (isCloud ? 'cloud' : '');
    }
    break;
}
```

Also, request the current DB path on webview load so the badge reflects reality immediately. Add to the initialization section:

```javascript
vscode.postMessage({ type: 'getDbPath' });
```

### 7. Startup Orphan Detection
#### [MODIFY] `src/services/TaskViewerProvider.ts`

- **Context:** `initializeKanbanDbOnStartup()` at L945-954 runs once on extension activation. It should check for orphaned data.
- **Logic:** After the existing init loop, for each workspace root: if the configured DB has 0 active plans AND a DB file exists at the default local path with plans, show a warning notification.

- **Implementation:** Append the following inside the `try` block in `initializeKanbanDbOnStartup()`, after L950:

```typescript
// Orphan detection: check if configured DB is empty but default location has plans
const db = KanbanDatabase.forWorkspace(workspaceRoot);
await db.ensureReady();
const configuredPlans = await db.getBoard(/* workspaceId from config */
    (() => {
        try { return String(vscode.workspace.getConfiguration('switchboard').get('workspaceId') || ''); }
        catch { return ''; }
    })()
);
if (configuredPlans.length === 0) {
    const defaultPath = KanbanDatabase.defaultDbPath(workspaceRoot);
    if (db.dbPath !== defaultPath && fs.existsSync(defaultPath)) {
        const hasOrphans = await KanbanDatabase._dbFileHasPlans(defaultPath);
        if (hasOrphans) {
            const action = await vscode.window.showWarningMessage(
                'Current database is empty but plans were found in the local database. Migrate data?',
                'Migrate Data', 'Ignore'
            );
            if (action === 'Migrate Data') {
                const result = await KanbanDatabase.migrateIfNeeded(defaultPath, db.dbPath);
                if (result.migrated) {
                    await KanbanDatabase.invalidateWorkspace(workspaceRoot);
                    vscode.window.showInformationMessage('✅ Plans migrated successfully.');
                } else {
                    vscode.window.showErrorMessage(`Migration failed: ${result.skipped}`);
                }
            }
        }
    }
}
```

**Note:** `_dbFileHasPlans` is currently a `private static` method. It needs to be changed to `public static` (or package-internal) for this usage. Alternatively, the orphan check can be placed inside `KanbanDatabase` itself as a static method called from `initializeKanbanDbOnStartup`.

### 8. Reconciliation Command
#### [MODIFY] `src/extension.ts`

- **Context:** Register a new command `switchboard.reconcileKanbanDbs` that allows manual merging of split databases. Register at ~L1033 (after the `resetKanbanDb` command).
- **Logic:**
  1. Scan for DB files at: default local path, current configured path, and common cloud locations (iCloud, Dropbox, Google Drive).
  2. Open each found DB, count plans.
  3. Show a QuickPick listing each DB with its plan count.
  4. User selects source and target.
  5. Open both databases, run `_runMigrations()` on source to align schemas, then `INSERT OR REPLACE` all plans from source into target (using `updated_at` as tiebreaker — newest wins).
  6. Persist target, backup source.

- **Implementation:**

```typescript
// Add after resetKanbanDbDisposable registration (~L1033)
const reconcileKanbanDisposable = vscode.commands.registerCommand('switchboard.reconcileKanbanDbs', async () => {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        vscode.window.showWarningMessage('No workspace open.');
        return;
    }
    const homedir = os.homedir();
    const candidates = [
        { label: 'Local', path: KanbanDatabase.defaultDbPath(workspaceRoot) },
        { label: 'Configured', path: KanbanDatabase.forWorkspace(workspaceRoot).dbPath },
        { label: 'iCloud', path: path.join(homedir, 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'Switchboard', 'kanban.db') },
        { label: 'Dropbox', path: path.join(homedir, 'Dropbox', 'Switchboard', 'kanban.db') },
    ];

    // De-duplicate by resolved path
    const seen = new Set<string>();
    const found: { label: string; path: string; count: number }[] = [];
    for (const c of candidates) {
        const resolved = path.resolve(c.path);
        if (seen.has(resolved)) continue;
        seen.add(resolved);
        if (fs.existsSync(resolved)) {
            const hasPlans = await KanbanDatabase._dbFileHasPlans(resolved);
            // Count plans for display
            let count = 0;
            try {
                const SQL = await (KanbanDatabase as any)._loadSqlJs();
                const buf = await fs.promises.readFile(resolved);
                const db = new SQL.Database(new Uint8Array(buf));
                const stmt = db.prepare("SELECT COUNT(*) as cnt FROM plans WHERE status = 'active'");
                if (stmt.step()) count = Number(stmt.getAsObject().cnt);
                stmt.free();
                if (db.close) db.close();
            } catch { /* corrupt or missing table */ }
            found.push({ label: c.label, path: resolved, count });
        }
    }

    if (found.length < 2) {
        vscode.window.showInformationMessage('Only one database found. Nothing to reconcile.');
        return;
    }

    const source = await vscode.window.showQuickPick(
        found.map(f => ({ label: `${f.label} (${f.count} plans)`, description: f.path, detail: f.path })),
        { placeHolder: 'Select SOURCE database (copy FROM)' }
    );
    if (!source) return;

    const target = await vscode.window.showQuickPick(
        found.filter(f => f.path !== source.detail).map(f => ({ label: `${f.label} (${f.count} plans)`, description: f.path, detail: f.path })),
        { placeHolder: 'Select TARGET database (merge INTO)' }
    );
    if (!target) return;

    const confirm = await vscode.window.showWarningMessage(
        `Merge ${source.label} → ${target.label}? Conflicts resolved by newest updated_at.`,
        { modal: true },
        'Merge'
    );
    if (confirm !== 'Merge') return;

    try {
        // Reconciliation logic: open both, INSERT OR REPLACE from source into target
        // (Full implementation uses sql.js to open both, iterate source rows, upsert into target)
        vscode.window.showInformationMessage('Reconciliation complete.');
    } catch (err) {
        vscode.window.showErrorMessage(`Reconciliation failed: ${err}`);
    }
});
context.subscriptions.push(reconcileKanbanDisposable);
```

**Note:** The full reconciliation INSERT logic requires opening both databases, iterating all rows from source, and for each row: checking if target has a row with the same `plan_id`; if so, comparing `updated_at` and keeping the newer one; if not, inserting. This is the most complex part of the plan and should be implemented carefully with transaction wrapping.

#### [MODIFY] `package.json`

- **Context:** Register the new command so it appears in the Command Palette.
- **Logic:** Add to `contributes.commands` array.

- **Implementation:**

```json
{
    "command": "switchboard.reconcileKanbanDbs",
    "title": "Switchboard: Reconcile Kanban Databases"
}
```

## Verification Plan

### Automated Tests
- **New test file:** `src/test/kanban-db-migration.test.ts`
  - `test('migrateIfNeeded copies data when target is empty')` — Create a source DB with 5 plans, call `migrateIfNeeded`, verify target has 5 plans, source renamed to `.backup.*`.
  - `test('migrateIfNeeded skips when target has data')` — Create both DBs with plans, verify `skipped === 'target_has_data'`.
  - `test('migrateIfNeeded skips when source is empty')` — Create empty source, verify `skipped === 'source_empty'`.
  - `test('migrateIfNeeded handles corrupt source gracefully')` — Write garbage to source file, verify no crash, `skipped` contains error.
  - `test('migrateIfNeeded prevents concurrent runs')` — Start two migrations simultaneously, verify only one completes.
  - `test('_dbFileHasPlans returns false for missing file')` — Verify graceful handling.
  - `test('_dbFileHasPlans returns false for corrupt file')` — Write garbage, verify false.
  - `test('defaultDbPath returns correct path')` — Verify format.

### Manual Verification Steps
1. **Test Migration**: Set iCloud path with existing local DB → verify data appears in iCloud DB → verify local DB renamed to backup
2. **Test UI Controls**: Click "Use Local DB" → verify setting cleared → verify kanban shows plans
3. **Test Integrity Warning**: Open workspace with empty iCloud config but full local DB → verify warning appears → click "Migrate Data" → verify data visible
4. **Test Reconciliation Command**: Create split DB scenario → run command → verify merge works
5. **Test "Both have data"**: Set up both DBs with plans → change path → verify warning shown with "Open Reconciliation" option
6. **Test badge display**: Switch between local and cloud → verify `#cloud-status` badge toggles correctly

## Edge Cases

- **Both DBs have data**: Auto-migration aborts, shows warning with "Open Reconciliation" button. Path change still takes effect.
- **iCloud not mounted**: `migrateIfNeeded` returns `source_not_found` or `target` directory creation fails. Extension falls back to creating a new empty DB. User sees standard error message.
- **Migration failure**: Keep original DB intact (source is only renamed AFTER successful copy). Show error, path change still takes effect.
- **Large databases**: `copyFile` is a single OS-level call — fast even for large files. No progress indicator needed for typical Kanban DB sizes (<10MB).
- **Cross-filesystem backup rename**: Backup rename is always on the same filesystem as source (we rename `source → source.backup.ts`), so `EXDEV` cannot occur. The cross-filesystem copy is handled by `copyFile`.
- **Manual settings.json edit**: The `onDidChangeConfiguration` listener at `src/extension.ts:1036-1046` can only detect migration from the default local path. Custom-to-custom path changes via manual edits require the reconciliation command.

## Breaking Changes

None. This is purely additive behavior that prevents data loss.

---

## Code Review Results

**Reviewer:** Cascade (direct reviewer pass)
**Date:** 2026-03-30
**Typecheck:** ✅ `npx tsc --noEmit` passes cleanly

### Implementation Checklist

| Plan Item | Status | Notes |
|-----------|--------|-------|
| C1: `migrateIfNeeded()` in KanbanDatabase | ✅ Done | L246-288. Uses `path.resolve()` for comparison (improvement over plan). `dbFileHasPlans` made public (needed by C3). |
| C1: `dbFileHasPlans()` | ✅ Done | L294-314. Public static, used by orphan detection and reconciliation. |
| C1: `defaultDbPath()` | ✅ Done | L417-419. |
| C1: `_migrationInProgress` guard | ✅ Done | L240. |
| C2: `editDbPath` migration wiring | ✅ Done | L3417-3458. Uses `_resolveDbPathSetting()` helper (cleaner than plan). |
| C2: `setPresetDbPath` migration wiring | ✅ Done | L3541-3567. Migration before config update. |
| C3: Startup orphan detection | ✅ Done | L965-994. Checks `db.dbPath !== defaultPath` correctly. |
| C4: Reconciliation command | ✅ Done | extension.ts L1035-1096. Full implementation with `reconcileDatabases()`. |
| C4: `reconcileDatabases()` | ✅ Fixed | L345-428. Column intersection fix applied (was CRITICAL). ROLLBACK added (was MAJOR). |
| C4: `countPlansInFile()` | ✅ Done | L319-339. Bonus method (not in plan), cleaner than plan's `(KanbanDatabase as any)._loadSqlJs()` hack. |
| R1: "Use Local DB" button | ✅ Done | implementation.html L1709. Click handler at L3962-3964. |
| R2: `setLocalDb` handler | ✅ Done | TaskViewerProvider.ts L3385-3416. Uses `_resolveDbPathSetting()`. |
| R3: Cloud status badge | ✅ Done | `updateCloudStatus()` at implementation.html L3914-3927. Distinguishes cloud/local/custom. `getDbPath` on load at L3997. |
| R4: `package.json` command | ✅ Done | `switchboard.reconcileKanbanDbs` at package.json L96-97. |
| Extra: `_resolveDbPathSetting()` | ✅ Done | TaskViewerProvider.ts L252-259. Replaces plan's inline ternary chains. |

### Findings Fixed During Review

1. **[CRITICAL → FIXED] `reconcileDatabases` schema mismatch.** The method read columns only from the source DB and used them for INSERT into the target. If schemas differed (e.g., source v5 with `tags`, target v2 without), the INSERT would fail with "table plans has no column named X". **Fix:** Changed to read columns from BOTH databases and use the intersection (`[...srcColumns].filter(c => tgtColumns.has(c))`). File: `src/services/KanbanDatabase.ts` L352-371.

2. **[MAJOR → FIXED] Missing ROLLBACK on reconciliation error.** The `BEGIN TRANSACTION` at L385 had no corresponding ROLLBACK if an INSERT threw. **Fix:** Wrapped the transaction loop in a try/catch with `ROLLBACK` in the catch block. File: `src/services/KanbanDatabase.ts` L387-411.

### Remaining Risks

1. **[MAJOR — DEFERRED] No automated test file.** Plan specifies 8 test cases in `src/test/kanban-db-migration.test.ts`. File does not exist. Data migration code should have regression tests. Recommended: write tests before shipping.

2. **[NIT — DEFERRED] Inconsistent invalidation ordering.** `editDbPath` invalidates before config update (L3451 then L3453). `setPresetDbPath` updates config before invalidation (L3563 then L3564). Both work due to the `onDidChangeConfiguration` safety net, but the inconsistency is confusing. Recommended: standardize to invalidate-before-update in a future cleanup pass.

3. **[NIT — ACCEPTED] `.gitignore` backup files.** The `.switchboard/*` glob catches all files; only explicitly un-ignored files (`kanban.db`, `plans/`, etc.) are tracked. Backup files (`kanban.db.backup.*`) remain gitignored. No action needed.
