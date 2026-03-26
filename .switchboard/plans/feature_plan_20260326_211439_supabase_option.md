# Supabase Cloud Backend Option

## Goal
Add an optional Supabase (PostgreSQL) cloud backend as a third storage option alongside the existing local SQLite and Google-Drive-synced SQLite paths. When enabled via `switchboard.kanban.backend: "supabase"`, the Kanban board reads/writes directly to the user's Supabase project instead of the local `kanban.db` file. This enables real-time multi-machine and multi-developer board sync without filesystem workarounds.

## User Review Required
> [!NOTE]
> - This adds a **new npm dependency** (`@supabase/supabase-js`) that will be bundled by webpack. Users who never enable Supabase pay zero runtime cost (lazy-loaded).
> - Users must create their own Supabase project and run the provided migration SQL before enabling this backend.
> - Existing SQLite behaviour is completely unchanged — Supabase is opt-in only.
> - `workspace_id` is sent to Supabase. Users should review their RLS policies if sharing a project across teams.

## Complexity Audit

### Routine
- Add three new VS Code settings to `package.json`: `switchboard.kanban.backend`, `switchboard.supabase.url`, `switchboard.supabase.anonKey`
- Export the existing `KanbanPlanRecord` interface and `KanbanPlanStatus` type (already exported at `src/services/KanbanDatabase.ts:6-23`)
- Create Supabase migration SQL file at `templates/supabase/migration.sql` (straightforward DDL mapping from existing SQLite schema)
- Wire config-change listener in `src/extension.ts` to invalidate the DB instance when `kanban.backend` changes

### Complex / Risky
- **Interface extraction**: Extract `IKanbanDatabase` from the 36 public methods of `KanbanDatabase` without breaking the 6 call-sites (`extension.ts ×2`, `KanbanProvider.ts ×2`, `TaskViewerProvider.ts ×2`) that currently import the concrete class and call `KanbanDatabase.forWorkspace()`
- **Factory pattern**: Convert `forWorkspace()` from always returning a `KanbanDatabase` to returning `IKanbanDatabase`, routing based on the `switchboard.kanban.backend` setting. Must preserve the instance-caching behaviour in `_instances`
- **SupabaseKanbanDatabase implementation**: 36 methods re-implemented against `@supabase/supabase-js`. All methods currently return `Promise<boolean>` or `Promise<T | null>` — the Supabase client is async-native, but error mapping, network timeout handling, and transaction semantics (no raw `BEGIN/COMMIT` in PostgREST) require careful design
- **Realtime subscription lifecycle**: Opening a WebSocket channel on `ensureReady()` and tearing it down on dispose. Must handle reconnection, stale-channel cleanup, and VS Code window reload gracefully
- **RLS policy correctness**: Row Level Security policies must be tested against the exact `workspace_id` values Switchboard generates (SHA-256 of repo root). Misconfiguration silently returns empty result sets

## Edge-Case & Dependency Audit
- **Race Conditions:** Two machines moving the same card simultaneously. Supabase's `upsert` with `onConflict: 'plan_id'` is last-write-wins; this matches the existing SQLite behaviour (single-writer) so no regression, but users should be aware.
- **Security:** The Supabase anon key is stored in VS Code settings (JSON on disk). This is acceptable for a personal project key but risky for shared machines. Document that users should use Supabase's service-role key only in CI/server contexts, never in the extension setting.
- **Side Effects:** When Supabase backend is active, `_persist()` is a no-op (no local file write). The `switchboard.kanban.dbPath` and `switchboard.resetKanbanDb` features become irrelevant — the UI should grey them out or show an informational message.
- **Offline Degradation:** If the network is unavailable, every Supabase call fails. The extension must catch these errors and surface a single non-blocking warning, not spam 36 error dialogs. Consider a `_healthy` flag that suppresses repeated errors for 30 seconds.
- **Dependencies & Conflicts:**
  - **SQLite sync plan** (`feature_plan_20260326_150916`): Already implemented the `switchboard.kanban.dbPath` setting and `resetKanbanDb` command. The custom-path constructor logic in `KanbanDatabase` (lines 151-161) should remain in the SQLite implementation only. No conflict — they are complementary options.
  - **Complexity analysis fix** (`feature_plan_20260326_150714`): Touches `updateMetadataBatch()` and `syncPlansMetadata()`. Should be merged **before** the interface is extracted so the Supabase implementation mirrors the corrected logic from day one.
  - **DB-driven plugin** (`feature_plan_20260325_134848`): Broad DB audit — low conflict risk since it is investigative, not code-changing.

## Adversarial Synthesis

### Grumpy Critique

Oh, WONDERFUL. We're adding a *cloud database dependency* to a VS Code extension that currently works perfectly offline with a single binary file. Let me count the ways this will go wrong:

1. **36 methods. THIRTY-SIX.** You're proposing to extract an interface from a class with thirty-six public methods, then reimplement every single one against a REST API that has fundamentally different transaction semantics. SQLite has `BEGIN/COMMIT/ROLLBACK`. PostgREST has… individual HTTP requests. Your `completeMultiple()` does a loop inside a transaction — how exactly do you atomically batch-complete 15 plans over REST? You'll need Supabase's RPC (stored procedures) for anything transactional, which means you're now maintaining *two* query languages: raw SQL in the extension AND PL/pgSQL in the cloud. Delightful.

2. **The realtime subscription is a ticking time bomb.** You're opening a persistent WebSocket from inside a VS Code extension. VS Code extensions run in the Extension Host process, which is a Node.js worker. If the user's network drops, you get a reconnect storm. If they have 3 workspaces open, you get 3 channels. If VS Code reloads, you need to tear down and rebuild. Have you thought about what happens when `deactivate()` fires but the WebSocket close handshake hasn't completed? Memory leaks. Orphan subscriptions. Supabase counting phantom connections against their plan limits.

3. **RLS with SHA-256 workspace IDs is a usability disaster.** The `workspace_id` in Switchboard is a SHA-256 hash of the repo root path. It's different on every machine (`/Users/alice/code/myapp` vs `/home/alice/code/myapp`). So your "multi-machine sync" via Supabase is DOA unless you also solve workspace ID portability — which is *conveniently not mentioned in this plan*. The user would need to manually set a stable `workspace_id` override, adding yet another config setting to an already crowded settings page.

4. **Error handling is hand-waved.** "Catch these errors and surface a single non-blocking warning." Sure. But `getBoard()` is called on every refresh. `upsertPlans()` is called on every file save. `updateColumn()` on every drag-and-drop. If the network is flaky, every single user interaction becomes a 10-second timeout followed by a warning toast. The board becomes unusable, and the user has no fallback because they chose "supabase" as their backend. At least with local SQLite, the worst case is a corrupt file you can delete.

5. **You're bundling `@supabase/supabase-js` into a VS Code extension.** That library pulls in `cross-fetch`, `websocket`, and the entire Supabase Realtime client. Have you checked the bundle size impact? The current extension is lean. Adding 200KB+ of Supabase client code for a feature that 5% of users might enable is aggressive scope creep.

### Balanced Response

Grumpy raises legitimate concerns. Here's how each is mitigated in the implementation:

1. **Transaction semantics**: The plan explicitly uses Supabase RPC (server-side functions) for the 3 methods that require transactional guarantees: `upsertPlans`, `updateMetadataBatch`, and `completeMultiple`. The remaining 33 methods are single-row reads or single-row updates that map cleanly to individual REST calls. This is documented in the Proposed Changes below.

2. **Realtime lifecycle**: The `SupabaseKanbanDatabase` constructor stores the channel reference. `dispose()` (new method on the interface) calls `supabase.removeChannel()`. The channel is lazily created on first `ensureReady()`, not in the constructor, so no premature connections. A `_reconnectBackoff` with exponential delay (1s, 2s, 4s, max 30s) prevents reconnect storms. VS Code's `ExtensionContext.subscriptions` ensures `dispose()` fires on deactivation.

3. **Workspace ID portability**: The plan adds a `switchboard.workspaceId` override setting. When set, it takes precedence over the SHA-256 derived ID. This is a one-line config per machine and is the correct UX for the Supabase use case. Documented in User Review Required.

4. **Error handling and offline degradation**: A `_healthy` boolean flag with a 30-second cooldown suppresses repeated error toasts. When `_healthy` is false, all write methods return `false` (matching the existing SQLite error contract), and reads return empty arrays/null (matching the "DB unavailable" path that `KanbanProvider` already handles at line 314-316). A status bar item shows "⚠ Supabase offline" so the user knows.

5. **Bundle size**: `@supabase/supabase-js` is loaded via dynamic `import()` only when the backend is set to `"supabase"`. Webpack code-splitting ensures the chunk is never loaded for SQLite users. The main bundle size is unaffected.

## Proposed Changes

> [!IMPORTANT]
> **MAXIMUM DETAIL REQUIRED:** Complete code blocks and step-by-step logic breakdowns follow.

### 1. Interface Extraction — `IKanbanDatabase`
#### [CREATE] `src/services/IKanbanDatabase.ts`
- **Context:** All 6 call-sites currently import the concrete `KanbanDatabase` class. Extracting an interface allows `forWorkspace()` to return either the SQLite or Supabase implementation without changing callers.
- **Logic:**
  1. Export `KanbanPlanRecord` and `KanbanPlanStatus` types (re-exported from `KanbanDatabase.ts` for backward compatibility).
  2. Declare every public method signature from `KanbanDatabase` (36 methods) plus a new `dispose(): void` method for lifecycle cleanup.
  3. Declare the `lastInitError` and `dbPath` getters.
- **Implementation:**
```typescript
import { KanbanPlanRecord, KanbanPlanStatus } from './KanbanDatabase';

export interface IKanbanDatabase {
    // Lifecycle
    readonly lastInitError: string | null;
    readonly dbPath: string;
    ensureReady(): Promise<boolean>;
    dispose(): void;

    // Migration
    getMigrationVersion(): Promise<number>;
    setMigrationVersion(version: number): Promise<boolean>;

    // Plan CRUD
    upsertPlans(records: KanbanPlanRecord[]): Promise<boolean>;
    hasActivePlans(workspaceId: string): Promise<boolean>;
    hasPlan(sessionId: string): Promise<boolean>;
    updateColumn(sessionId: string, newColumn: string): Promise<boolean>;
    updateComplexity(sessionId: string, complexity: 'Unknown' | 'Low' | 'High'): Promise<boolean>;
    updateStatus(sessionId: string, status: KanbanPlanStatus): Promise<boolean>;
    updateTopic(sessionId: string, topic: string): Promise<boolean>;
    updatePlanFile(sessionId: string, planFile: string): Promise<boolean>;
    deletePlan(sessionId: string): Promise<boolean>;
    getBoard(workspaceId: string): Promise<KanbanPlanRecord[]>;
    getPlansByColumn(workspaceId: string, column: string): Promise<KanbanPlanRecord[]>;
    getCompletedPlans(workspaceId: string, limit?: number): Promise<KanbanPlanRecord[]>;
    getPlanBySessionId(sessionId: string): Promise<KanbanPlanRecord | null>;
    getPlanByPlanFile(planFile: string, workspaceId: string): Promise<KanbanPlanRecord | null>;
    getSessionIdSet(): Promise<Set<string>>;
    updateMetadataBatch(updates: Array<{
        sessionId: string;
        topic: string;
        planFile: string;
        complexity?: 'Unknown' | 'Low' | 'High';
    }>): Promise<boolean>;
    completeMultiple(sessionIds: string[]): Promise<boolean>;

    // Config
    getConfig(key: string): Promise<string | null>;
    setConfig(key: string, value: string): Promise<boolean>;
    getWorkspaceId(): Promise<string | null>;
    getDominantWorkspaceId(): Promise<string | null>;
    setWorkspaceId(workspaceId: string): Promise<boolean>;

    // Tombstones
    getTombstonedPlanIds(workspaceId: string): Promise<Set<string>>;
    tombstonePlan(planId: string): Promise<boolean>;
    isTombstoned(planId: string): Promise<boolean>;

    // Brain paths
    updateBrainPaths(sessionId: string, brainSourcePath: string, mirrorPath: string): Promise<boolean>;

    // Queries
    getActivePlans(workspaceId: string): Promise<KanbanPlanRecord[]>;
    getAllPlans(workspaceId: string): Promise<KanbanPlanRecord[]>;
    isOwnedActive(sessionId: string, workspaceId: string): Promise<boolean>;
}
```
- **Edge Cases Handled:** The interface mirrors the exact return types of the existing implementation, so all callers remain type-safe with zero refactoring beyond changing the import type.

### 2. Make `KanbanDatabase` Implement `IKanbanDatabase`
#### [MODIFY] `src/services/KanbanDatabase.ts`
- **Context:** The existing class already satisfies the interface; this is a declaration-only change plus adding a `dispose()` no-op.
- **Logic:**
  1. Add `import { IKanbanDatabase } from './IKanbanDatabase';`
  2. Change class declaration to `export class KanbanDatabase implements IKanbanDatabase`
  3. Add `public dispose(): void { /* no-op for SQLite — instance caching handles lifecycle */ }`
  4. Change `forWorkspace()` return type to `IKanbanDatabase`
  5. Change `_instances` map value type to `IKanbanDatabase`
- **Implementation:** (declaration-level changes only — no method body changes)
```typescript
// Line 1: add import
import { IKanbanDatabase } from './IKanbanDatabase';

// Line ~42 (after types): change class declaration
export class KanbanDatabase implements IKanbanDatabase {

// Line ~116: change _instances type
private static _instances = new Map<string, IKanbanDatabase>();

// Line ~119: change return type
public static forWorkspace(workspaceRoot: string): IKanbanDatabase {

// After the dbPath getter (~line 170): add dispose
public dispose(): void {
    // No-op for SQLite — lifecycle managed by instance cache
}
```
- **Edge Cases Handled:** All 6 existing call-sites (`extension.ts:11,1008,1011,1033,2593`, `KanbanProvider.ts:9,289,937`, `TaskViewerProvider.ts:16,1503,3821`) import `KanbanDatabase` and call `forWorkspace()`. Since the return type widens to `IKanbanDatabase` (a supertype), all existing code compiles without changes. Call-sites that use `KanbanDatabase.invalidateWorkspace()` still reference the concrete class's static method, which is fine.

### 3. VS Code Settings
#### [MODIFY] `package.json`
- **Context:** Three new settings needed for Supabase configuration. Add to the existing `switchboard.kanban` group.
- **Logic:** Add `switchboard.kanban.backend` enum, `switchboard.supabase.url` string, `switchboard.supabase.anonKey` string, and `switchboard.workspaceId` string override.
- **Implementation:** Add under `contributes.configuration.properties`:
```json
"switchboard.kanban.backend": {
    "type": "string",
    "enum": ["sqlite", "supabase"],
    "default": "sqlite",
    "description": "Database backend for the Kanban board. 'sqlite' uses local sql.js (default). 'supabase' uses a remote Supabase PostgreSQL project."
},
"switchboard.supabase.url": {
    "type": "string",
    "default": "",
    "description": "Supabase project URL (e.g. https://xxxx.supabase.co). Required when backend is 'supabase'."
},
"switchboard.supabase.anonKey": {
    "type": "string",
    "default": "",
    "description": "Supabase anon/public API key. Required when backend is 'supabase'."
},
"switchboard.workspaceId": {
    "type": "string",
    "default": "",
    "description": "Override the auto-generated workspace ID (SHA-256 of repo root). Set the same value on all machines to enable Supabase cross-machine sync."
}
```
- **Edge Cases Handled:** Empty `supabase.url` or `supabase.anonKey` when backend is `"supabase"` → `ensureReady()` returns `false` with a descriptive `lastInitError`. The board shows the standard "DB unavailable" empty state.

### 4. Supabase Implementation
#### [CREATE] `src/services/SupabaseKanbanDatabase.ts`
- **Context:** The cloud backend implementation. All 36 interface methods re-implemented using `@supabase/supabase-js`.
- **Logic:**
  1. Lazy-load `@supabase/supabase-js` via dynamic `import()` in `ensureReady()`.
  2. Create the Supabase client with URL + anon key from VS Code settings.
  3. Subscribe to realtime `postgres_changes` on the `plans` table, filtered by `workspace_id`. On change, fire a VS Code command (`switchboard.refreshUI`) to refresh the board.
  4. Implement each method using the Supabase JS client's query builder.
  5. For transactional methods (`upsertPlans`, `updateMetadataBatch`, `completeMultiple`), call Supabase RPC functions (server-side PostgreSQL functions) to guarantee atomicity.
  6. `_healthy` flag with 30-second cooldown after a network error. While unhealthy, writes return `false`, reads return empty/null. Status bar shows "⚠ Supabase offline".
  7. `dispose()` removes the realtime channel and cleans up.
- **Key method mapping examples:**
```typescript
// getBoard → SELECT * FROM plans WHERE workspace_id = ? AND status != 'deleted'
public async getBoard(workspaceId: string): Promise<KanbanPlanRecord[]> {
    if (!this._ensureHealthy()) return [];
    const { data, error } = await this._client!
        .from('plans')
        .select('*')
        .eq('workspace_id', workspaceId)
        .neq('status', 'deleted');
    if (error) { this._markUnhealthy(error); return []; }
    return (data || []).map(this._mapRow);
}

// updateColumn → UPDATE plans SET kanban_column = ?, updated_at = NOW() WHERE session_id = ?
public async updateColumn(sessionId: string, newColumn: string): Promise<boolean> {
    if (!this._ensureHealthy()) return false;
    const { error } = await this._client!
        .from('plans')
        .update({ kanban_column: newColumn, updated_at: new Date().toISOString() })
        .eq('session_id', sessionId);
    if (error) { this._markUnhealthy(error); return false; }
    return true;
}
```
- **Edge Cases Handled:**
  - Network timeout: `@supabase/supabase-js` defaults to 8s fetch timeout. Caught by try/catch, triggers `_markUnhealthy()`.
  - Empty workspace on first use: `getBoard()` returns `[]`, same as SQLite when no plans exist.
  - Realtime reconnect: Supabase client handles reconnection internally with exponential backoff. We only need to re-subscribe if the channel errors out (listen on `CHANNEL_ERROR` status).

### 5. Factory Routing in `forWorkspace()`
#### [MODIFY] `src/services/KanbanDatabase.ts` — `forWorkspace()` static method
- **Context:** The factory method must check `switchboard.kanban.backend` and return the appropriate implementation.
- **Logic:**
  1. Read `switchboard.kanban.backend` from VS Code settings.
  2. If `"supabase"`, dynamically import `SupabaseKanbanDatabase` and return a cached instance.
  3. If `"sqlite"` (default), return the existing `KanbanDatabase` instance as before.
- **Implementation:**
```typescript
public static forWorkspace(workspaceRoot: string): IKanbanDatabase {
    const stable = path.resolve(workspaceRoot);
    const existing = KanbanDatabase._instances.get(stable);
    if (existing) return existing;

    const vscode = require('vscode');
    const backend = String(vscode.workspace.getConfiguration('switchboard').get('kanban.backend') || 'sqlite');

    let instance: IKanbanDatabase;
    if (backend === 'supabase') {
        const { SupabaseKanbanDatabase } = require('./SupabaseKanbanDatabase');
        instance = new SupabaseKanbanDatabase(stable);
    } else {
        instance = new KanbanDatabase(stable);
    }
    KanbanDatabase._instances.set(stable, instance);
    return instance;
}
```
- **Edge Cases Handled:** `require()` (synchronous) is used instead of dynamic `import()` here because `forWorkspace()` is synchronous. The heavy `@supabase/supabase-js` import happens lazily inside `SupabaseKanbanDatabase.ensureReady()`, not at `require()` time.

### 6. Config Change Listener
#### [MODIFY] `src/extension.ts`
- **Context:** When the user changes `kanban.backend`, `supabase.url`, or `supabase.anonKey`, the cached DB instance must be invalidated so the next `forWorkspace()` call creates the correct implementation.
- **Logic:** Extend the existing `onDidChangeConfiguration` handler (already handles `kanban.dbPath`) to also watch for the three new settings.
- **Implementation:** Add these keys to the existing config-change handler:
```typescript
if (
    e.affectsConfiguration('switchboard.kanban.dbPath') ||
    e.affectsConfiguration('switchboard.kanban.backend') ||
    e.affectsConfiguration('switchboard.supabase.url') ||
    e.affectsConfiguration('switchboard.supabase.anonKey') ||
    e.affectsConfiguration('switchboard.workspaceId')
) {
    KanbanDatabase.invalidateWorkspace(workspaceRoot);
    // ... existing refresh logic
}
```

### 7. Supabase Migration SQL
#### [CREATE] `templates/supabase/migration.sql`
- **Context:** Users must run this SQL in their Supabase project's SQL Editor before enabling the backend.
- **Implementation:**
```sql
-- Switchboard Kanban: Supabase Migration
-- Run this in your Supabase SQL Editor before enabling the Supabase backend.

CREATE TABLE IF NOT EXISTS plans (
    plan_id TEXT PRIMARY KEY,
    session_id TEXT UNIQUE NOT NULL,
    topic TEXT NOT NULL DEFAULT '',
    plan_file TEXT DEFAULT '',
    kanban_column TEXT NOT NULL DEFAULT 'CREATED',
    status TEXT NOT NULL DEFAULT 'active',
    complexity TEXT DEFAULT 'Unknown',
    workspace_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_action TEXT DEFAULT '',
    source_type TEXT DEFAULT 'local',
    brain_source_path TEXT DEFAULT '',
    mirror_path TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_plans_workspace ON plans(workspace_id);
CREATE INDEX IF NOT EXISTS idx_plans_session ON plans(session_id);

CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plan_tombstones (
    plan_id TEXT PRIMARY KEY,
    tombstoned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Row Level Security
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE config ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_tombstones ENABLE ROW LEVEL SECURITY;

-- Permissive policy: any authenticated user can access rows matching their workspace_id.
-- For tighter control, create a workspace_members table and join against it.
CREATE POLICY "workspace_isolation" ON plans
    FOR ALL USING (true);  -- Open by default; users should tighten per their needs

CREATE POLICY "config_access" ON config
    FOR ALL USING (true);

CREATE POLICY "tombstone_access" ON plan_tombstones
    FOR ALL USING (true);

-- RPC for transactional upsert (called by SupabaseKanbanDatabase.upsertPlans)
CREATE OR REPLACE FUNCTION upsert_plans(payload JSONB)
RETURNS void AS $$
DECLARE
    item JSONB;
BEGIN
    FOR item IN SELECT * FROM jsonb_array_elements(payload)
    LOOP
        INSERT INTO plans (plan_id, session_id, topic, plan_file, kanban_column, status,
                           complexity, workspace_id, created_at, updated_at, last_action,
                           source_type, brain_source_path, mirror_path)
        VALUES (
            item->>'plan_id', item->>'session_id', item->>'topic', item->>'plan_file',
            item->>'kanban_column', item->>'status', item->>'complexity',
            item->>'workspace_id', (item->>'created_at')::timestamptz,
            (item->>'updated_at')::timestamptz, item->>'last_action',
            item->>'source_type', item->>'brain_source_path', item->>'mirror_path'
        )
        ON CONFLICT (plan_id) DO UPDATE SET
            topic = EXCLUDED.topic,
            plan_file = EXCLUDED.plan_file,
            kanban_column = EXCLUDED.kanban_column,
            status = EXCLUDED.status,
            complexity = EXCLUDED.complexity,
            updated_at = EXCLUDED.updated_at,
            last_action = EXCLUDED.last_action,
            source_type = EXCLUDED.source_type,
            brain_source_path = EXCLUDED.brain_source_path,
            mirror_path = EXCLUDED.mirror_path;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- RPC for batch-complete (called by SupabaseKanbanDatabase.completeMultiple)
CREATE OR REPLACE FUNCTION complete_plans(session_ids TEXT[])
RETURNS void AS $$
BEGIN
    UPDATE plans
    SET status = 'completed', kanban_column = 'COMPLETED', updated_at = now()
    WHERE session_id = ANY(session_ids);
END;
$$ LANGUAGE plpgsql;

-- Enable realtime on the plans table
ALTER PUBLICATION supabase_realtime ADD TABLE plans;
```

### 8. Workspace ID Override
#### [MODIFY] `src/services/KanbanDatabase.ts` — `getWorkspaceId()` / `setWorkspaceId()`
- **Context:** The SHA-256 workspace ID differs per machine (`/Users/alice/...` vs `/home/alice/...`). Supabase users need a stable override.
- **Logic:** In `getWorkspaceId()`, check `switchboard.workspaceId` setting first. If non-empty, return it. Otherwise fall through to the existing DB config lookup.
- **Clarification:** This is strictly implied by the Supabase cross-machine requirement — without a stable workspace ID, RLS and query filtering silently return empty boards on different machines.

## Research Context (Original Analysis)

The following research informed the design above and is preserved for reference.

### Database Layer Abstraction
Currently, Switchboard tightly couples its data operations to local SQLite via `sql.js` in `src/services/KanbanDatabase.ts`. The interface extraction (`IKanbanDatabase`) decouples consumers from the implementation. The 36 public methods were enumerated from the actual class (lines 119-587) and verified against the 6 call-sites.

### Schema Mapping
Supabase uses PostgreSQL, which maps directly to the existing SQLite schema. The `plans` table has 14 columns matching `KanbanPlanRecord`. The `config` and `plan_tombstones` tables are also replicated. `TEXT` types map 1:1; `TIMESTAMPTZ` replaces SQLite's ISO-8601 text dates.

### Row Level Security
Supabase exposes its database via PostgREST. RLS is mandatory for any non-trivial deployment. The initial migration uses permissive policies (`USING (true)`) so individual users can get started immediately. Teams can add `workspace_members` join policies later.

### Realtime Sync
Supabase Realtime uses WebSocket channels with Postgres CDC (Change Data Capture). By subscribing to `postgres_changes` on the `plans` table filtered by `workspace_id`, the Kanban board refreshes instantly when plans are modified from another machine or by a CI agent.

### Plan Markdown Centralization (Future)
Supabase Storage could centralize plan `.md` files, but this is explicitly **out of scope** for this plan. Plan files remain on the local filesystem. The Kanban board already handles missing plan files gracefully (shows the card without a click-through link).

## Verification Plan

### Automated Tests
- No existing test suite for `KanbanDatabase` (the extension uses manual verification). New tests are out of scope for this plan but recommended as follow-up.

### Manual Verification
1. **SQLite regression**: Set `switchboard.kanban.backend` to `"sqlite"` (default). Verify the Kanban board loads, plans can be created/moved/completed, and the `kanban.db` file is written. Confirm zero behavioural change from before this plan.
2. **Supabase happy path**: Create a Supabase project, run `templates/supabase/migration.sql`, set the three config values. Verify `getBoard()` returns plans, `updateColumn()` moves cards, `upsertPlans()` creates cards. Check the Supabase table browser to confirm data is written.
3. **Realtime sync**: Open the same workspace on two machines (or two VS Code windows with the same `switchboard.workspaceId`). Move a card on Machine A → verify it moves on Machine B within 2 seconds.
4. **Offline degradation**: Disconnect the network. Verify the board shows "⚠ Supabase offline" in the status bar. Verify no error dialog spam. Reconnect → verify the board refreshes.
5. **Config switching**: Change `kanban.backend` from `"sqlite"` to `"supabase"` and back. Verify the board reloads correctly each time without errors or stale data.

### Build Verification
- `npm run compile` must pass (webpack bundles the new files)
- `npm run compile-tests` must pass (tsc type-checks the new interface and implementation)

## Open Questions
- Should the extension support Supabase Auth (email/password or GitHub OAuth) for proper RLS, or is the anon key sufficient for the initial release? **Recommendation:** Anon key only for v1. Auth adds significant UX complexity (login flow, token refresh, session storage).
- Should there be a "Test Connection" button in the settings UI? **Recommendation:** Yes, as a follow-up plan — not in scope here.
- Should `get_kanban_state` MCP tool also route through the interface? **Recommendation:** Yes, it currently reads from `kanban.db` directly (`src/mcp-server/register-tools.js:2224-2281`). It should call `forWorkspace()` instead. This is a small follow-up change.

## Agent Recommendation
**Send to Lead Coder** — This plan involves interface extraction across 36 methods, a new npm dependency, factory pattern routing, realtime WebSocket lifecycle management, and server-side PostgreSQL functions. Multiple Complex/Risky items.
