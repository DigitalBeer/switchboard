# SQLite DB Not Syncing Correctly Across Machines

## Goal
Allow users to configure a custom path for the kanban database file (`kanban.db`) so it can be stored in a cloud-synced folder (Google Drive, Dropbox, OneDrive, iCloud) for seamless multi-machine handover. Additionally, provide a "Reset Database" command that deletes the local DB and rebuilds it from the current repo state, enabling a quick recovery when switching machines.

This is a simple, pragmatic solution for the primary use case: a single developer swapping between machines (e.g., work laptop and home PC) who needs a clean handover without git merge conflicts on binary files. It avoids complex sync protocols, JSON sidecars, or merge drivers.

**Recommendation:** Send to Coder — this is a configuration wiring change plus a simple reset command.

## User Review Required
> [!NOTE]
> - No breaking changes. The default behaviour is unchanged — `kanban.db` stays in `.switchboard/` by default.
> - New optional setting `switchboard.kanban.dbPath` allows pointing the DB to any folder (e.g., `~/Google Drive/Switchboard/kanban.db`).
> - New command **"Switchboard: Reset Kanban Database"** provides one-click DB reset for machine handover.
> - If a custom DB path is set, the `.switchboard/kanban.db` in the workspace is no longer used. The user should ensure the custom path folder is synced by their cloud service.
> - **WAL mode note:** sql.js is a WASM port and does not support WAL mode. This is a fundamental limitation of the architecture. The custom-path approach sidesteps the need for WAL entirely.

## Complexity Audit
### Routine
- Add `switchboard.kanban.dbPath` setting to `package.json` `contributes.configuration` section
- Add `switchboard.resetKanbanDb` command to `package.json` `contributes.commands` section
- Register the reset command handler in `src/extension.ts`
- Read the setting in `KanbanDatabase.ts` constructor to compute `_dbPath`
- Implement the reset command (delete DB file, trigger re-init)

### Complex / Risky
- **Cache invalidation on setting change:** If a user changes `switchboard.kanban.dbPath` while the extension is active, the cached `KanbanDatabase` instance in the static `_instances` Map still points to the old path. Must listen for configuration changes and invalidate the cache. This is the only moderately complex logic change.

## Edge-Case & Dependency Audit
- **Race Conditions:** The reset command deletes the DB file and calls `ensureReady()` to re-initialize. If a refresh or persist is in flight, the `_writeTail` promise queue will encounter a missing file. Mitigate by setting `_db = null` and `_initPromise = null` atomically before re-init, which forces the next `ensureReady()` call to run `_initialize()` from scratch.
- **Security:** The custom path is user-configured. If pointed at a shared/public folder, plan metadata (topics, file paths) would be exposed. This is the user's responsibility. No credentials are stored in the DB.
- **Side Effects:** When using a cloud-synced path, the cloud service handles sync. If both machines are open simultaneously with the same DB file, cloud services may create conflict copies (e.g., `kanban (1).db`). This is acceptable — the use case is non-simultaneous handover.
- **Dependencies & Conflicts:**
  - `feature_plan_20260326_150714_complexity_analysis_not_working_properly.md` — Fixes stale complexity in DB. Complementary; the custom path DB will benefit from the fix.
  - `feature_plan_20260325_134848_db_driven_plugin.md` — Major DB architecture plan. Complementary; the custom path just changes where the DB lives, not how it works internally.

## Adversarial Synthesis

### Grumpy Critique

So let me get this straight. The "solution" to cross-machine DB sync is... telling the user to go install Google Drive and point a VS Code setting at it? That's not engineering, that's a support article. "Step 1: Buy a cloud service. Step 2: Configure a path. Step 3: Hope their sync daemon doesn't corrupt a binary SQLite file mid-write."

And this "Reset Database" command — what does "rebuild from the current repo state" even mean? The DB contains kanban column positions, completion status, complexity ratings — none of that is in the repo. The plan files are in the repo. The session JSONs are in the repo. But the *board state* is in the DB. If you delete the DB and "rebuild," every card goes back to CREATED with Unknown complexity. That's not a reset, that's amnesia.

Also: Google Drive's sync daemon writes to files whenever it damn well pleases. If the extension has the DB open in-memory (sql.js loads the entire file on init), and Google Drive updates the file underneath it, the extension won't notice. The next `_persist()` will overwrite Google Drive's version with the stale in-memory copy. Congratulations, you've built a sync mechanism that reliably overwrites incoming changes.

And the cache invalidation on config change? The `_instances` Map is keyed by workspace root path, not by DB path. If the user changes the setting, you need to evict the old instance, close any open statements, null out `_db`, and create a fresh instance with the new path. Miss any of those steps and you get silent writes to the old location.

### Balanced Response

Grumpy raises four valid concerns:

1. **"Not engineering":** Fair — but this is intentionally minimal. The user asked for a simple solution for non-simultaneous machine handover, not a distributed database. Pointing the DB at a cloud-synced folder is the lowest-complexity approach that solves the actual use case. Larger teams can build their own sync layer on top of this open-source project.

2. **"Reset = amnesia":** Partially valid. The reset command should NOT just delete the DB — it should delete and then trigger a full `_syncFilesAndRefreshRunSheets()` cycle, which rebuilds the DB from session files and plan files on disk. This recovers topics, plan file paths, and last-known column positions from runsheet events. Complexity will be re-parsed from plan files (especially after the complexity analysis fix lands). The only data truly lost is manual column overrides that weren't reflected in runsheet events.

3. **"Cloud sync overwrites":** Valid concern. Mitigate with documentation: the custom path is designed for non-simultaneous use. The user should close VS Code on Machine A before opening on Machine B. For extra safety, add a file-modification-time check in `_initialize()`: if the DB file on disk is newer than when it was last loaded, reload it. This handles the case where Google Drive updates the file between extension activations.

4. **"Cache invalidation":** The implementation must: (a) listen for `vscode.workspace.onDidChangeConfiguration`, (b) check if `switchboard.kanban.dbPath` changed, (c) remove the old instance from `_instances`, (d) set `_db = null` and `_initPromise = null` on the old instance, (e) let the next `ensureReady()` call create a fresh instance at the new path.

## Proposed Changes
> [!IMPORTANT]
> **MAXIMUM DETAIL REQUIRED:** Provide complete, fully functioning code blocks.

### Change 1: Add configuration setting
#### [MODIFY] `package.json`
- **Context:** The `contributes.configuration.properties` section (around line 92) defines all extension settings. We need to add `switchboard.kanban.dbPath` for the custom DB location.
- **Logic:** Add a string setting with empty default (meaning "use default `.switchboard/kanban.db`"). Also add the reset command.
- **Implementation:**

Add to `contributes.configuration.properties` (after `switchboard.kanban.completedLimit`):

```json
"switchboard.kanban.dbPath": {
    "type": "string",
    "default": "",
    "description": "Custom file path for the Kanban database (e.g., ~/Google Drive/Switchboard/kanban.db). If empty, uses the default .switchboard/kanban.db in the workspace root. Use this to store the DB in a cloud-synced folder for multi-machine handover.",
    "scope": "resource"
}
```

Add to `contributes.commands` array:

```json
{
    "command": "switchboard.resetKanbanDb",
    "title": "Switchboard: Reset Kanban Database"
}
```

- **Edge Cases Handled:** Empty string means default behaviour — no change for existing users.

### Change 2: Read custom DB path in KanbanDatabase constructor
#### [MODIFY] `src/services/KanbanDatabase.ts`
- **Context:** The constructor at line 136-138 hardcodes `_dbPath` to `.switchboard/kanban.db`. We need to check the VS Code setting first.
- **Logic:**
  1. Import `vscode` (already available in the extension context).
  2. In the constructor, read `switchboard.kanban.dbPath` from configuration.
  3. If non-empty, resolve it (expand `~`, resolve relative paths) and use it as `_dbPath`.
  4. If empty, use the default path as before.
- **Implementation:**

Replace the constructor (lines 136-138):

```typescript
private constructor(private readonly _workspaceRoot: string) {
    const vscode = require('vscode');
    const customPath = vscode.workspace.getConfiguration('switchboard').get<string>('kanban.dbPath', '').trim();
    if (customPath) {
        // Expand ~ to home directory
        const resolved = customPath.startsWith('~')
            ? path.join(require('os').homedir(), customPath.slice(1))
            : customPath;
        // Resolve relative paths against workspace root
        this._dbPath = path.isAbsolute(resolved) ? resolved : path.join(this._workspaceRoot, resolved);
    } else {
        this._dbPath = path.join(this._workspaceRoot, '.switchboard', 'kanban.db');
    }
}
```

- **Edge Cases Handled:**
  - `~` expansion for macOS/Linux home directory paths.
  - Relative paths resolved against workspace root.
  - Empty or whitespace-only string falls back to default.

### Change 3: Add cache invalidation on config change
#### [MODIFY] `src/services/KanbanDatabase.ts`
- **Context:** The static `_instances` Map caches DB instances by workspace root. If the user changes `kanban.dbPath`, the cached instance still points to the old path.
- **Logic:** Add a static method `invalidateWorkspace(workspaceRoot)` that removes the cached instance. Call it from a config change listener in `extension.ts`.
- **Implementation:**

Add static method to `KanbanDatabase` class:

```typescript
/**
 * Invalidate the cached DB instance for a workspace, forcing re-creation
 * on the next forWorkspace() call. Used when kanban.dbPath setting changes.
 */
public static invalidateWorkspace(workspaceRoot: string): void {
    const stable = path.resolve(workspaceRoot);
    const existing = KanbanDatabase._instances.get(stable);
    if (existing) {
        existing._db = null;
        existing._initPromise = null;
        KanbanDatabase._instances.delete(stable);
        console.log(`[KanbanDatabase] Invalidated cached instance for ${stable}`);
    }
}
```

#### [MODIFY] `src/extension.ts`
- **Context:** Register a configuration change listener to invalidate the DB cache when `kanban.dbPath` changes.
- **Implementation:**

Add in the `activate()` function, near other event listener registrations:

```typescript
context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('switchboard.kanban.dbPath')) {
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (workspaceRoot) {
                KanbanDatabase.invalidateWorkspace(workspaceRoot);
                // Trigger a full board refresh to pick up the new DB path
                vscode.commands.executeCommand('switchboard.refreshUI');
            }
        }
    })
);
```

- **Edge Cases Handled:** If no workspace is open, the listener does nothing. The `refreshUI` command triggers a full re-read from the new DB path.

### Change 4: Register reset command
#### [MODIFY] `src/extension.ts`
- **Context:** The "Reset Kanban Database" command needs to delete the DB file and trigger a full rebuild.
- **Logic:**
  1. Get the current DB path (from config or default).
  2. Invalidate the cached instance.
  3. Delete the DB file from disk.
  4. Trigger a full sync (`switchboard.fullSync`) which rebuilds the DB from plan/session files.
- **Implementation:**

Add command registration in `activate()`:

```typescript
context.subscriptions.push(
    vscode.commands.registerCommand('switchboard.resetKanbanDb', async () => {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            vscode.window.showWarningMessage('No workspace open.');
            return;
        }

        const confirm = await vscode.window.showWarningMessage(
            'This will delete the local Kanban database and rebuild it from plan files. Continue?',
            { modal: true },
            'Reset'
        );
        if (confirm !== 'Reset') return;

        // Resolve the DB path (same logic as constructor)
        const customPath = vscode.workspace.getConfiguration('switchboard').get<string>('kanban.dbPath', '').trim();
        let dbPath: string;
        if (customPath) {
            const resolved = customPath.startsWith('~')
                ? path.join(require('os').homedir(), customPath.slice(1))
                : customPath;
            dbPath = path.isAbsolute(resolved) ? resolved : path.join(workspaceRoot, resolved);
        } else {
            dbPath = path.join(workspaceRoot, '.switchboard', 'kanban.db');
        }

        // Invalidate cache
        KanbanDatabase.invalidateWorkspace(workspaceRoot);

        // Delete DB file
        try {
            const fs = require('fs');
            if (fs.existsSync(dbPath)) {
                await fs.promises.unlink(dbPath);
            }
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to delete DB: ${err}`);
            return;
        }

        // Trigger full rebuild from plan/session files
        await vscode.commands.executeCommand('switchboard.fullSync');
        vscode.window.showInformationMessage('Kanban database has been reset and rebuilt.');
    })
);
```

- **Edge Cases Handled:**
  - Confirmation dialog prevents accidental resets.
  - Missing file is handled gracefully (existsSync check).
  - `fullSync` triggers `_syncFilesAndRefreshRunSheets()` which rebuilds the DB from session files and plan files.

## Verification Plan
### Automated Tests
- Verify that when `switchboard.kanban.dbPath` is empty, the DB is created at `.switchboard/kanban.db` (default behaviour, no regression).
- Verify that when `switchboard.kanban.dbPath` is set to `/tmp/test-kanban.db`, the DB is created at that path.
- Verify that `~` expansion works: `~/Switchboard/kanban.db` resolves to `$HOME/Switchboard/kanban.db`.
- Verify `invalidateWorkspace()` removes the cached instance and the next `forWorkspace()` call creates a fresh one.

### Manual Tests
1. Set `switchboard.kanban.dbPath` to a Google Drive folder path in VS Code settings.
2. Verify the kanban board loads and cards are visible.
3. Move a card, verify the DB file in Google Drive updates (check file modification time).
4. Close VS Code, switch to another machine, open the same project with the same setting.
5. Verify the board shows the card in its updated position.
6. Run "Switchboard: Reset Kanban Database" command. Verify the board rebuilds from plan files.

### Build Verification
- Run `npm run compile` to verify TypeScript compilation succeeds.
- Run `npm run compile-tests` to verify test compilation.

## Open Questions
- Should the reset command also offer to delete session files (`.switchboard/sessions/`), or just the DB? For now, just the DB is safest.
- Should we show a notification when the extension detects the DB file was modified externally (e.g., by Google Drive sync)? This could be a future enhancement.

---

## Post-Implementation Review (2026-03-27)

### Implementation Status: ✅ COMPLETE — All 4 changes implemented

| Change | File | Status |
|--------|------|--------|
| 1. `switchboard.kanban.dbPath` setting + `switchboard.resetKanbanDb` command | `package.json` | ✅ Implemented (lines 92–94, 224–229) |
| 2. Custom DB path in KanbanDatabase constructor | `src/services/KanbanDatabase.ts` | ✅ Implemented (lines 151–162) |
| 3. `invalidateWorkspace()` static method | `src/services/KanbanDatabase.ts` | ✅ Implemented (lines 130–146) |
| 4. Config change listener + reset command | `src/extension.ts` | ✅ Implemented (lines 994–1038) |

### Review Findings

| # | Finding | Severity | Disposition |
|---|---------|----------|-------------|
| 1 | `_writeTail` race in `invalidateWorkspace` — in-flight persist silently dropped when `_db` nulled before write completes | **CRITICAL** | **FIXED** |
| 2 | `require('vscode')` in KanbanDatabase constructor breaks unit test isolation | MAJOR | Deferred — functional in extension host; refactor to caller-injected config is a larger change |
| 3 | `dbPath` getter on zombie instances after invalidation | MAJOR | Accepted — reset command correctly extracts path before invalidating |
| 4 | No automated test coverage for new features | NIT | Deferred — requires extension host mocking infrastructure |

### Fixes Applied

**Fix 1 (CRITICAL): Drain `_writeTail` before invalidation**
- `src/services/KanbanDatabase.ts` — `invalidateWorkspace()` changed from `void` to `async Promise<void>`. Now awaits `existing._writeTail` before setting `_db = null`, preventing silent data loss from in-flight persist operations.
- `src/extension.ts` line 1011 — Added `await` to `invalidateWorkspace()` call in reset command handler.
- `src/extension.ts` line 1029 — Config change listener callback made `async`, added `await` to `invalidateWorkspace()` call.

### Files Changed During Review
- `src/services/KanbanDatabase.ts` (lines 130–146: invalidateWorkspace signature + drain logic)
- `src/extension.ts` (line 1011: await added; lines 1029–1033: async callback + await added)

### Validation Results
- `npx tsc --noEmit` — ✅ Pass (exit 0)
- `npm run compile` (webpack) — ✅ Pass (both extension + MCP server bundles compiled successfully)

### Remaining Risks
- **`require('vscode')` in constructor**: If KanbanDatabase is ever unit-tested outside the extension host, the constructor will throw. Low risk — no such tests exist today.
- **Cloud sync conflict copies**: If two machines have VS Code open simultaneously with the same custom DB path, cloud services may create conflict copies (e.g., `kanban (1).db`). Documented as by-design for non-simultaneous handover.
- **No file-modification-time check**: The plan's Balanced Response suggested checking if the DB file on disk is newer than the loaded copy. Not implemented. Future enhancement for detecting external (cloud-sync) modifications between extension activations.
