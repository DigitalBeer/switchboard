# Migrate _readSessionTitleMap to Database-First

## Goal
Eliminate the remaining filesystem dependency in `SessionActionLog._readSessionTitleMap()` by migrating it to query the `KanbanDatabase.plans` table instead of reading `sessions/` and `archive/` directories.

## Background
The SQLite migration (`feature_plan_20260328_131128_finish_sqlite_migration.md`) moved session and activity logging from filesystem to database. However, `_readSessionTitleMap()` still walks the filesystem:

```typescript
const archiveDir = path.join(this.sessionsDir, '..', 'archive');
const archiveEntries = await fs.promises.readdir(archiveDir);
const sessionEntries = await fs.promises.readdir(this.sessionsDir);
```

This was acceptable during the transition window, but represents technical debt. The `KanbanDatabase.plans` table already stores `topic` (the session title) for every plan.

## Implementation

### 1. Add DB-first query to _readSessionTitleMap
**File:** `src/services/SessionActionLog.ts`

Modify `_readSessionTitleMap()` (around line 412) to query the database first:

```typescript
private async _readSessionTitleMap(): Promise<Record<string, string>> {
    const now = Date.now();
    if (now - this._sessionTitleCacheTime < 5000 && this._sessionTitleCache) {
        return this._sessionTitleCache;
    }

    // DB-first: query titles from KanbanDatabase
    const db = await this._ensureDbReady();
    if (db) {
        try {
            const workspaceId = await db.getWorkspaceId() || await db.getDominantWorkspaceId();
            if (workspaceId) {
                const plans = await db.getAllPlans(workspaceId);
                const titleMap: Record<string, string> = {};
                for (const plan of plans) {
                    if (plan.sessionId && plan.topic) {
                        titleMap[plan.sessionId] = plan.topic;
                    }
                }
                this._sessionTitleCache = titleMap;
                this._sessionTitleCacheTime = now;
                return titleMap;
            }
        } catch (e) {
            // Fall through to filesystem fallback during transition
            console.warn('[SessionActionLog] Failed to read titles from DB, falling back to filesystem:', e);
        }
    }

    // DEPRECATED: Filesystem fallback — remove once all legacy files migrated
    // [existing readdir logic remains as fallback]
    return this._readSessionTitleMapFromFilesystem();
}

private async _readSessionTitleMapFromFilesystem(): Promise<Record<string, string>> {
    // [move existing readdir implementation here]
}
```

### 2. Add getAllPlans method if missing
**File:** `src/services/KanbanDatabase.ts`

Ensure `getAllPlans(workspaceId: string)` exists. It should be similar to `getBoard()` but return all plans regardless of status:

```typescript
public async getAllPlans(workspaceId: string): Promise<KanbanPlanRecord[]> {
    if (!(await this.ensureReady()) || !this._db) return [];
    const stmt = this._db.prepare(
        `SELECT ${PLAN_COLUMNS} FROM plans WHERE workspace_id = ? ORDER BY updated_at ASC`,
        [workspaceId]
    );
    return this._readRows(stmt);
}
```

Note: `getAllPlans` may already exist — verify before adding.

### 3. Add migration timeline comment
**File:** `src/services/SessionActionLog.ts`

Add a TECH-DEBT comment above the filesystem fallback:

```typescript
// TECH-DEBT: Filesystem fallback for title map — remove after all legacy .json files purged
// Target removal: 30 days after SQLite migration confirmed stable
```

## Verification Plan

### Automated Tests
- Run `npx tsc --noEmit` — no type errors from new async patterns
- Run `npm test` — existing SessionActionLog tests should pass

### Manual Verification
1. Open Switchboard with a workspace that has active plans
2. Trigger any action that generates an activity event (dispatch, terminal command)
3. Open the Activity feed in the sidebar
4. **Expected:** Activity events display with correct session titles
5. **Failure mode:** If broken, titles show as session IDs or empty strings

### Multi-workspace Verification
1. Open two workspace folders
2. Verify `_readSessionTitleMap` correctly returns titles for the active workspace only
3. Switch between workspaces and verify titles update correctly

## Complexity
- **Scope:** 2 files (`SessionActionLog.ts`, possibly `KanbanDatabase.ts`)
- **Risk:** Low — additive change with fallback; existing behavior preserved if DB fails
- **Dependencies:** SQLite migration must be stable (it is)

## Adversarial Considerations
- **Shape mismatch risk:** `KanbanPlanRecord.topic` vs legacy file `topic` field — verify both sources return same shape
- **Cache invalidation:** The 5-second TTL cache remains; DB query is faster than readdir so no perf concern
- **Workspace isolation:** Must ensure `getAllPlans` filters by correct `workspaceId` to avoid cross-workspace title leakage

## Agent Recommendation
**Send to Coder** — Refactoring within established patterns, clear fallback strategy, well-scoped. No architectural changes.

## Reviewer Pass — 2026-03-29

### Findings Summary

| Severity | Finding | Location |
|----------|---------|----------|
| MAJOR | Dead `sessionsDir` property — declared/assigned but never read after DB migration | `SessionActionLog.ts:33,51` |
| MAJOR | No-op migration stubs (`_migrateActivityLog`, `_migrateSessionFiles`) lack `@deprecated` tags and removal timeline | `SessionActionLog.ts:776-782` |
| MAJOR | Empty-Map fallback on DB failure (lines 403-405) lacked documentation explaining degradation semantics | `SessionActionLog.ts:403` |
| NIT | `console.error` used instead of plan-specified `console.warn` — acceptable; error-level is appropriate for a catch block | `SessionActionLog.ts:399` |
| NIT | `getAllPlans` returns all statuses including `deleted` — correct for title-map use case (historical titles needed for activity feed) | `KanbanDatabase.ts:770` |
| NIT | Plan Section 1 specified `Record<string, string>` return type; implementation uses `Map<string, string>` — correct, callers use `.get()` | `SessionActionLog.ts:375` |

### Files Changed

- **`src/services/SessionActionLog.ts`**
  - Removed dead `sessionsDir` property and constructor assignment (lines 33, 51)
  - Added `@deprecated` JSDoc + removal timeline to no-op migration stubs
  - Added TECH-DEBT comment on empty-Map fallback path documenting degradation behavior

### Validation Results

- `npx tsc --noEmit` — **PASS** (exit code 0, no errors)

### Remaining Risks

- **No-op migration stubs + `_migrationDone` flag**: These exist solely to guard the no-op methods. The entire `_ensureDbReady` migration block (lines 65-69) can be removed in v1.6, simplifying to a direct `ensureReady()` check.
- **5-second TTL on empty-Map cache**: If the DB is temporarily unavailable, titles degrade to session IDs for up to 5 seconds. Acceptable but worth monitoring.
- **`console.error` noise**: During extension activation, if the DB isn't ready yet, the error log at line 399 may fire once. Low impact but could confuse log readers.
