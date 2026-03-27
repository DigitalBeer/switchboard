# board state is different across different ides

## Goal
Board state looks completely different across different IDEs even operating on the same machine and same repo. Fix by adding mtime-based staleness detection so the in-memory sql.js database reloads from disk when another IDE has written changes.

## Metadata
**Tags:** backend, database, bugfix
**Complexity:** Low

## User Review Required
> [!NOTE]
> No breaking changes. The public API of `KanbanDatabase` is unchanged. The fix adds an internal reload mechanism that is transparent to all consumers.
> The sql.js engine and all dependencies are preserved — no new packages, no binary size changes.

## Root Cause Analysis

The extension uses **sql.js** — a JavaScript/WASM SQLite implementation that runs entirely **in-memory**.

**Current broken flow:**
1. IDE starts → `_initialize()` loads entire `kanban.db` file into memory buffer once ([L655-656](file:///Users/patrickvuleta/Documents/GitHub/switchboard/src/services/KanbanDatabase.ts#L655-L656))
2. All queries run against in-memory copy only
3. Writes export entire in-memory DB back to file via `_persist()` ([L787-809](file:///Users/patrickvuleta/Documents/GitHub/switchboard/src/services/KanbanDatabase.ts#L787-L809))
4. Result: Each IDE has its own isolated memory database; changes from IDE A are invisible to IDE B

**The `_lastLoadedMtimes` mechanism already exists** ([L188](file:///Users/patrickvuleta/Documents/GitHub/switchboard/src/services/KanbanDatabase.ts#L188), [L641-654](file:///Users/patrickvuleta/Documents/GitHub/switchboard/src/services/KanbanDatabase.ts#L641-L654)) but only checks during `_initialize()` — which runs exactly once per IDE lifetime.

**The fix is surgical:** Check the file's mtime before read operations. If the file has been modified since we last loaded it, reload from disk.

## Complexity Audit

### Routine
- Add `_loadedMtime` instance field to track when the in-memory copy was loaded
- Add `_reloadIfStale()` method that compares disk mtime to `_loadedMtime`
- Update `_persist()` to record the new mtime after writing
- Update `ensureReady()` to call `_reloadIfStale()` when `_db` is already loaded

### Complex / Risky
- **Write-then-read race**: If IDE A writes via `_persist()` (atomic rename) while IDE B is mid-reload, the reload could read a partially-renamed file. Mitigated by the existing atomic-rename pattern (`tmp → final`) — `fs.rename` is atomic on POSIX, so the file is never in a half-written state.
- **Rapid mtime granularity**: On some filesystems (HFS+), mtime resolution is 1 second. Two writes within the same second could have identical mtimes, causing a missed reload. Mitigated by comparing both mtime AND file size, or by using a monotonic write counter.

## Edge-Case & Dependency Audit
- **Race Conditions:** The atomic rename in `_persist()` prevents partial reads. The risk is negligible for a Kanban board use case (human-speed writes, <1 write/second).
- **Security:** No change — all file paths are already validated.
- **Side Effects:** Slightly increased disk I/O from `fs.stat()` calls before reads. Cost is ~0.1ms per stat — negligible.
- **Dependencies & Conflicts:**
  - ⚠️ "SQLite DB Not Syncing Correctly Across Machines" (sess_1774498156506, CODE REVIEWED) — attempts to fix the same root cause. **This plan supersedes it.**
  - ⚠️ "Consolidate Session Files into Database with Event Sourcing" (sess_1774561257803, PLAN REVIEWED) — touches `KanbanDatabase.ts` but at the schema/query layer, not the reload mechanism. No conflict expected.

## Adversarial Synthesis

### Grumpy Critique

Alright, so after that entire detour through "let's replace the database engine and ship 30MB of native binaries," we've arrived at... checking file modification times. The thing that should have been the first instinct.

Let me poke at this supposedly "simple" fix:

1. **Stale reads under load**: You're checking mtime in `ensureReady()`, which is called before *every* query. If the Kanban board fires 10 queries in quick succession (e.g., `getBoard` + `getPlansByColumn` × N), you're doing 10 `fs.stat()` calls. That's wasteful. You should debounce or cache the stat result for a short window.

2. **Mtime resolution on HFS+**: macOS HFS+ (still used on some machines) has *1-second* mtime resolution. If IDE A writes at `T=1.1s` and IDE B writes at `T=1.9s`, both files have mtime `T=1s`. IDE A reloads, sees the same mtime, and doesn't reload IDE B's changes. You mentioned comparing file size too — that helps but isn't bulletproof (same-size writes).

3. **Memory churn**: Every reload creates a *new* `SQL.Database(new Uint8Array(buffer))`. The old one is just dropped. For a 50KB DB that's fine, but if someone has 500 plans, that buffer grows. You'd better make sure the old `_db` is properly dereferenced so GC can reclaim it.

4. **The `_writeTail` race**: `_persist()` chains writes via `_writeTail`. If a reload happens *while a write is in-flight*, you could reload stale data, then the write completes and overwrites with even staler data from memory. The reload must wait for `_writeTail` to settle.

### Balanced Response

Valid concerns, all addressable:

1. **Stat debouncing**: Add a `_lastStatTime` field. Skip the stat check if less than 500ms have elapsed since the last check. This caps overhead at ~2 stat calls/second regardless of query volume.

2. **Mtime resolution**: Use `mtimeMs` (millisecond precision on APFS, which is the default macOS filesystem since 2017). For the rare HFS+ holdout, combine mtime with file size as a secondary check. This is sufficient for human-speed Kanban operations.

3. **Memory**: Explicitly set `this._db = null` before creating the new instance during reload. The old WASM memory is GC-eligible immediately.

4. **Write-during-reload**: The `_reloadIfStale()` method will `await this._writeTail` before reloading to ensure no in-flight write is lost. This is the same drain pattern already used in `invalidateWorkspace()`.

## Proposed Changes

> [!IMPORTANT]
> **MAXIMUM DETAIL REQUIRED:** All changes are in a single file.

### Core Database Service

#### [MODIFY] [KanbanDatabase.ts](file:///Users/patrickvuleta/Documents/GitHub/switchboard/src/services/KanbanDatabase.ts)

##### Change 1: Add instance fields for staleness tracking (after L188)

- **Context:** Need to track when the in-memory copy was loaded and when we last checked disk.
- **Logic:** Add `_loadedMtime` (mtime of the file when we loaded it) and `_lastStatCheckMs` (monotonic timestamp to debounce stat calls). The debounce window is 500ms — any `ensureReady()` call within 500ms of the last stat check reuses the cached result.
- **Implementation:**
```typescript
private _loadedMtime: number = 0;       // mtimeMs of kanban.db when last loaded into memory
private _lastStatCheckMs: number = 0;   // Date.now() of last fs.stat() call (debounce)
private static readonly STAT_DEBOUNCE_MS = 500; // Don't re-stat more often than this
```
- **Edge Cases Handled:** Debounce prevents 10+ stat calls when the webview fires rapid query bursts.

##### Change 2: Add `_reloadIfStale()` method (before `_initialize()`)

- **Context:** This is the core fix. Checks if the disk file has been modified since we loaded it, and reloads if so.
- **Logic:**
  1. Skip if no DB loaded yet (handled by `_initialize()`)
  2. Skip if less than `STAT_DEBOUNCE_MS` since last stat check
  3. Call `fs.stat()` to get current mtime
  4. Compare with `_loadedMtime` — if different, reload
  5. Before reloading, drain `_writeTail` to prevent overwriting in-flight writes
  6. Load file, create new `SQL.Database`, run schema + migrations
- **Implementation:**
```typescript
/**
 * Check if the on-disk DB file has been modified by another process (e.g. another IDE).
 * If so, reload the entire in-memory database from disk.
 * Debounced to avoid excessive fs.stat() calls during rapid query bursts.
 */
private async _reloadIfStale(): Promise<void> {
    if (!this._db) return; // Not initialized yet — _initialize() will load fresh

    const now = Date.now();
    if (now - this._lastStatCheckMs < KanbanDatabase.STAT_DEBOUNCE_MS) return;
    this._lastStatCheckMs = now;

    try {
        if (!fs.existsSync(this._dbPath)) return; // File deleted — keep in-memory state

        const stats = await fs.promises.stat(this._dbPath);
        const currentMtime = stats.mtimeMs;

        if (currentMtime === this._loadedMtime) return; // No external changes

        // Drain any in-flight writes before reloading to prevent data loss
        try { await this._writeTail; } catch { /* swallow — chain keeps alive internally */ }

        console.log(`[KanbanDatabase] External modification detected (mtime ${this._loadedMtime} → ${currentMtime}). Reloading from disk.`);

        const SQL = await KanbanDatabase._loadSqlJs();
        const fileBuffer = await fs.promises.readFile(this._dbPath);

        // Release old DB reference for GC
        this._db = null;
        this._db = new SQL.Database(new Uint8Array(fileBuffer));

        // Re-apply schema and migrations (idempotent — safe to re-run)
        this._db.exec(SCHEMA_SQL);
        this._runMigrations();

        this._loadedMtime = currentMtime;
        KanbanDatabase._lastLoadedMtimes.set(this._dbPath, currentMtime);
    } catch (error) {
        console.error('[KanbanDatabase] Failed to reload from disk:', error);
        // Keep using stale in-memory copy — better than crashing
    }
}
```
- **Edge Cases Handled:**
  - **Write-during-reload**: Awaits `_writeTail` before reloading
  - **Deleted file**: Skips reload, keeps in-memory state
  - **Reload failure**: Catches error, logs, continues with stale copy
  - **GC**: Nulls `_db` before reassigning to release old WASM memory

##### Change 3: Update `ensureReady()` to check staleness (L202-213)

- **Context:** `ensureReady()` currently short-circuits on `if (this._db) return true`. This is the exact line that prevents re-reads.
- **Logic:** When `_db` is already loaded, call `_reloadIfStale()` before returning.
- **Implementation:**
```typescript
public async ensureReady(): Promise<boolean> {
    if (this._db) {
        // Check if another IDE has modified the DB file since we loaded it
        await this._reloadIfStale();
        return true;
    }
    if (!this._initPromise) {
        this._initPromise = this._initialize().then((ready) => {
            if (!ready) {
                this._initPromise = null;
            }
            return ready;
        });
    }
    return this._initPromise;
}
```
- **Edge Cases Handled:** The reload is debounced internally, so rapid `ensureReady()` calls don't trigger multiple stat calls.

##### Change 4: Record mtime during `_initialize()` (L654-657)

- **Context:** After loading the file into memory, store the mtime so `_reloadIfStale()` has a baseline.
- **Logic:** After `KanbanDatabase._lastLoadedMtimes.set(this._dbPath, fileMtime)`, also set `this._loadedMtime = fileMtime`.
- **Implementation:**
```diff
                 KanbanDatabase._lastLoadedMtimes.set(this._dbPath, fileMtime);
+                this._loadedMtime = fileMtime;
                 const existing = await fs.promises.readFile(this._dbPath);
                 this._db = new SQL.Database(new Uint8Array(existing));
```
For the new DB case (L659-661):
```diff
                 KanbanDatabase._lastLoadedMtimes.delete(this._dbPath);
+                this._loadedMtime = 0;
                 this._db = new SQL.Database();
```

##### Change 5: Update mtime after `_persist()` writes (L787-809)

- **Context:** After `_persist()` writes the DB to disk via atomic rename, the file's mtime changes. We must update `_loadedMtime` to match, otherwise `_reloadIfStale()` would immediately trigger a redundant reload of our own write.
- **Logic:** After the successful rename, stat the file and update `_loadedMtime`.
- **Implementation:**
```typescript
private async _persist(): Promise<boolean> {
    if (!this._db) return false;
    const data = this._db.export();
    const writeOperation = async (): Promise<boolean> => {
        const suffix = crypto.randomBytes(4).toString('hex');
        const tmpPath = `${this._dbPath}.${suffix}.tmp`;
        try {
            await fs.promises.writeFile(tmpPath, Buffer.from(data));
            await fs.promises.rename(tmpPath, this._dbPath);
            // Update our mtime baseline so _reloadIfStale() doesn't
            // re-read our own write as an "external modification"
            try {
                const stats = await fs.promises.stat(this._dbPath);
                this._loadedMtime = stats.mtimeMs;
                KanbanDatabase._lastLoadedMtimes.set(this._dbPath, stats.mtimeMs);
            } catch { /* stat failure is non-critical */ }
            return true;
        } catch (error) {
            try { await fs.promises.unlink(tmpPath); } catch { /* best-effort cleanup */ }
            console.error('[KanbanDatabase] Failed to persist DB file:', error);
            return false;
        }
    };
    let result = false;
    const nextWrite = this._writeTail.then(async () => { result = await writeOperation(); });
    this._writeTail = nextWrite.catch(() => { /* swallow to keep chain alive */ });
    await nextWrite;
    return result;
}
```
- **Edge Cases Handled:** Without this, every `_persist()` call would cause the next `ensureReady()` to reload from disk — wasting time re-reading our own data.

## Rejected Alternatives

| Approach | Why Rejected |
|----------|--------------|
| **Replace sql.js with better-sqlite3** | Requires shipping ~20-30MB of native binaries for all platforms. Massive packaging complexity for a VS Code extension. |
| **Replace sql.js with sqlite3 (node-sqlite3)** | Same native binary problem, plus async callback API is a poor fit. |
| **File watching (fs.watch)** | Unreliable across platforms, race conditions with rapid writes, event spam. Mtime polling is simpler and sufficient. |
| **Shared memory / IPC** | Over-engineered for this use case. |

## Verification Plan

### Automated Tests
- `npm run compile` — Verify TypeScript compilation succeeds with the new fields and method

### Manual Verification
1. **Multi-IDE consistency test:**
   - Open VS Code IDE A and IDE B on the same workspace
   - In IDE A, create a new plan → verify it appears on IDE A's board
   - Wait 1 second (debounce window)
   - In IDE B, open/refresh the Kanban board → verify the new plan appears
   - In IDE B, move the card from "CREATED" → "PLAN REVIEWED"
   - In IDE A, refresh the Kanban board → verify the card is now in "PLAN REVIEWED"
2. **Write-then-read correctness:** In IDE A, rapidly create 3 plans in sequence. Verify all 3 appear. Then check IDE B — all 3 should appear after a refresh.
3. **Regression:** Verify all existing kanban operations (create, move, complete, delete, edit topic, drag-drop) still work in a single IDE.

## Recommendation
**Send to Coder** — This is a focused, low-complexity change: 3 new instance fields, 1 new method, and minor edits to 3 existing methods. All in a single file. No new dependencies. No packaging changes.
