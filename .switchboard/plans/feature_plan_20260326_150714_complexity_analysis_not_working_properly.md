# Complexity Analysis Not Working Properly — DB/File Mismatch Fix

## Goal
Fix the mismatch between a plan's actual complexity (as determined by parsing the plan file) and the complexity displayed on the Kanban board. The root cause is that `syncPlansMetadata()` passes `complexity: undefined` for any plan with `'Unknown'` in the DB, causing `updateMetadataBatch()` to skip the complexity column entirely. The Kanban board reads from the DB and shows stale `'Unknown'` values forever, while the review panel (which calls `getComplexityFromPlan()` and re-parses the file) shows the correct value.

**Recommendation:** Send to Lead Coder — this touches the DB sync pipeline, the board refresh hot path, and the migration layer across three tightly coupled files.

## User Review Required
> [!NOTE]
> - No breaking changes. The fix is purely internal — it upgrades stale `'Unknown'` DB rows to real parsed values.
> - After deploying this fix, plans that previously showed gray "Unknown" badges on the board will automatically resolve to green "Low" or red "High" on the next board refresh.
> - Manual Complexity Overrides set via the review panel dropdown are preserved (they write `'Low'` or `'High'` directly to the DB via `updateComplexity()` and are never `'Unknown'`).
> - There is a one-time performance cost on the first refresh after upgrade: every `'Unknown'` plan triggers a file read + regex parse. Subsequent refreshes skip plans already resolved to `'Low'` or `'High'`.

## Complexity Audit
### Routine
- Adding the re-parse loop in `_refreshBoardImpl()` — straightforward async iteration using the existing public `getComplexityFromPlan()` method and the existing `updateMetadataBatch()` DB writer.
- Updating `syncPlansMetadata()` to accept a complexity resolver callback — a signature change plus a conditional `await` call.
- Wiring the resolver callback at the call site in `KanbanProvider.ts` — one-line change.

### Complex / Risky
- **Hot-path performance in `_refreshBoardImpl()`:** The re-parse loop reads plan files from disk (via `fs.existsSync` + `fs.promises.readFile` inside `getComplexityFromPlan`). For boards with many `'Unknown'` plans on first refresh after upgrade, this could stall the webview update. Mitigation: only re-parse plans where `complexity === 'Unknown'`; once resolved, they are skipped on all future refreshes. Batch all DB writes into a single `updateMetadataBatch()` call (one transaction, one persist).
- **Race condition between `_refreshBoardImpl` and `syncPlansMetadata`:** Both paths may attempt to update the same row's complexity concurrently. Since SQLite writes are serialized within the same `KanbanDatabase` instance (in-memory sql.js with `_persistedUpdate`) and both will compute the same parsed value from the same file, last-writer-wins is safe.
- **`getComplexityFromPlan()` priority stack interaction:** The method checks the DB (priority 2, lines 886–906) before file content (priorities 3–4). When called from the refresh path for a plan with `'Unknown'` in the DB, the DB lookup will find `'Unknown'`, fall through, and proceed to file parsing — which is exactly the desired behavior. The redundant DB roundtrip is <1ms (in-memory sql.js) and not worth optimizing with a parameter.

## Edge-Case & Dependency Audit
- **Race Conditions:** `_refreshBoardImpl()` is guarded by the `_isRefreshing` flag (line 348). The re-parse loop runs inside this guard, so concurrent refreshes are already serialized. No new race condition introduced.
- **Security:** Plan file paths are resolved from DB records that were written during plan creation. Path traversal is mitigated by `path.isAbsolute()` / `path.join()` and `fs.existsSync()` guards already present in `getComplexityFromPlan()` (lines 872–873). No user input is injected into SQL (parameterized queries throughout).
- **Side Effects:** Writing updated complexity back to DB triggers a `_persist()` call (full binary export). By batching all updates into a single `updateMetadataBatch()` call, we get one persist instead of N. For the snapshot-based refresh path (`_refreshBoardWithData`), the same batching pattern applies.
- **Dependencies & Conflicts:**
  - `feature_plan_20260316_155425_fix_false_high_complexity_ratings.md` — Fixes Band B trailing text edge case in `getComplexityFromPlan`. **Complementary.** Our fix calls the same method; if that fix lands first, we get improved parsing for free.
  - `feature_plan_20260317_113032_fix_complexity_parsing_bug.md` — Fixes "None. This is simple." normalization in the same method. **Complementary.** Same reasoning.
  - `feature_plan_20260314_092147_restore_autoban_complexity_routing.md` — Exposes `getComplexityFromPlan()` as public. **Already done** — the method is already `public` at line 869 of `KanbanProvider.ts`. No conflict.

## Adversarial Synthesis
### Grumpy Critique
Oh, *magnificent*. We have a four-tier priority cascade in `getComplexityFromPlan()` — manual override, DB lookup, agent recommendation regex, Band B parsing — and yet the ONE place that actually feeds the Kanban board (`_refreshBoardImpl`) doesn't call ANY of them. It just slurps `row.complexity` straight from the DB and calls it a day. Meanwhile, `syncPlansMetadata()` dutifully receives `complexity: undefined` from the registry (because the registry never re-parses either) and `updateMetadataBatch()` helpfully says "undefined? Cool, I'll skip that column." So we have a *beautiful* four-tier parser that is called exactly NEVER in the hot path that matters.

And now the proposed fix is to shove file I/O into the board refresh path? For every `'Unknown'` plan? On a board with 80 plans where 60 of them haven't been through `/improve-plan` yet, that's 60 file reads blocking the webview update. *Chef's kiss.*

Also: `getComplexityFromPlan()` queries the DB as its second priority (line 886–906). If we're calling it FROM the refresh path because the DB says `'Unknown'`, it will query the DB, get `'Unknown'`, fall through, then parse the file. That works, but it's a wasted round-trip to the DB we already know has stale data. Not a bug, but it's the kind of needless indirection that makes future maintainers question reality.

And what about the snapshot rows in `syncPlansMetadata()`? The `complexity` field on `LegacyKanbanSnapshotRow` comes from wherever `_buildKanbanRecordFromSheet()` sets it. If THAT method also returns `'Unknown'` because it reads from the registry instead of parsing the file, we've only patched the display path and the sync path will continue to propagate `'Unknown'` forever. Whack-a-mole.

### Balanced Response
Grumpy raises three valid concerns. Here's how each is addressed:

1. **File I/O in refresh path:** Addressed by gating re-parse to ONLY `'Unknown'` plans with a non-empty `planFile`. Once a plan's complexity resolves to `'Low'` or `'High'` and is written back to the DB, it never re-parses again. The worst case is first-refresh after upgrade, where N plans parse once. Each plan file is a small Markdown file (<10KB). Subsequent refreshes are O(0) re-parses for a stable board. We also batch all DB writes into a single `updateMetadataBatch()` call — one transaction, one persist, not N.

2. **Redundant DB query inside `getComplexityFromPlan()`:** True but harmless. The in-memory sql.js lookup returns `'Unknown'` in <1ms, then falls through to file parsing. Adding a `skipDbLookup` parameter would expand the API surface for negligible gain. Not worth the added complexity.

3. **`syncPlansMetadata()` source of `complexity`:** This is the deeper fix. The implementation adds a `resolveComplexity` callback parameter to `syncPlansMetadata()`. The caller (`KanbanProvider`) passes `(planFile) => this.getComplexityFromPlan(workspaceRoot, planFile)`. During sync, any row with `'Unknown'` complexity is re-parsed through this callback before being passed to `updateMetadataBatch()`. This fixes the root cause, not just the symptom.

## Proposed Changes
> [!IMPORTANT]
> **MAXIMUM DETAIL REQUIRED:** Provide complete, fully functioning code blocks. Break down the logic step-by-step before showing code.

### Change 1: Re-parse stale complexity during board refresh
#### [MODIFY] `src/services/KanbanProvider.ts`
- **Context:** `_refreshBoardImpl()` (lines 368–452) builds the card array from DB rows and sends it to the webview. At line 400, it assigns `complexity: row.complexity || 'Unknown'` directly from the DB without checking whether the plan file has since gained a complexity signal. This is the display-side symptom of the bug.
- **Logic:**
  1. After loading `dbRows` from `db.getBoard()` (line 391) and logging, filter for rows where `(row.complexity || 'Unknown') === 'Unknown'` and `row.planFile` is non-empty.
  2. For each such row, call `this.getComplexityFromPlan(resolvedWorkspaceRoot, row.planFile)`.
  3. Collect all rows where the parsed value is `'Low'` or `'High'` into a `Map<sessionId, 'Low' | 'High'>` for overrides and a batch update array.
  4. Call `db.updateMetadataBatch()` once with the batch to persist all resolved complexities in a single transaction.
  5. When building the `cards` array, use the override map to substitute resolved complexity.
  6. Apply the same pattern to `_refreshBoardWithData()` (lines 458–520) for the snapshot-based refresh path.
- **Implementation:**

Insert the following block after line 392 (`console.log(...)`) and before line 394 (`cards = dbRows.map(...)`):

```typescript
                // Self-heal stale 'Unknown' complexity by re-parsing plan files.
                // Only runs for plans still at 'Unknown' in the DB — one-time cost per plan.
                const complexityOverrides = new Map<string, 'Low' | 'High'>();
                const unknownRows = dbRows.filter(r => (r.complexity || 'Unknown') === 'Unknown' && r.planFile);
                if (unknownRows.length > 0) {
                    const batchUpdates: Array<{ sessionId: string; topic: string; planFile: string; complexity: 'Low' | 'High' }> = [];
                    for (const row of unknownRows) {
                        const parsed = await this.getComplexityFromPlan(resolvedWorkspaceRoot, row.planFile);
                        if (parsed === 'Low' || parsed === 'High') {
                            complexityOverrides.set(row.sessionId, parsed);
                            batchUpdates.push({
                                sessionId: row.sessionId,
                                topic: row.topic || '',
                                planFile: row.planFile || '',
                                complexity: parsed
                            });
                        }
                    }
                    if (batchUpdates.length > 0) {
                        await db.updateMetadataBatch(batchUpdates);
                        console.log(`[KanbanProvider] Self-healed complexity for ${batchUpdates.length} plans`);
                    }
                }
```

Then modify the card-building `map` at line 394 to use the override map:

```typescript
                cards = dbRows.map(row => ({
                    sessionId: row.sessionId,
                    topic: row.topic || row.planFile || 'Untitled',
                    planFile: row.planFile || '',
                    column: this._normalizeLegacyKanbanColumn(row.kanbanColumn) || 'CREATED',
                    lastActivity: row.updatedAt || row.createdAt || '',
                    complexity: complexityOverrides.get(row.sessionId) || row.complexity || 'Unknown',
                    workspaceRoot: resolvedWorkspaceRoot
                }));
```

Apply the same pattern inside `_refreshBoardWithData()` after line 489 (after completed rows are pushed) and before line 491 (`const agentNames = ...`):

```typescript
            // Self-heal stale 'Unknown' complexity (snapshot-based refresh path).
            const complexityOverrides = new Map<string, 'Low' | 'High'>();
            const unknownCards = cards.filter(c => c.complexity === 'Unknown' && c.planFile);
            if (unknownCards.length > 0) {
                const db = this._getKanbanDb(resolvedWorkspaceRoot);
                const batchUpdates: Array<{ sessionId: string; topic: string; planFile: string; complexity: 'Low' | 'High' }> = [];
                for (const card of unknownCards) {
                    const parsed = await this.getComplexityFromPlan(resolvedWorkspaceRoot, card.planFile);
                    if (parsed === 'Low' || parsed === 'High') {
                        card.complexity = parsed;
                        complexityOverrides.set(card.sessionId, parsed);
                        batchUpdates.push({
                            sessionId: card.sessionId,
                            topic: card.topic || '',
                            planFile: card.planFile || '',
                            complexity: parsed
                        });
                    }
                }
                if (batchUpdates.length > 0) {
                    await db.updateMetadataBatch(batchUpdates);
                    console.log(`[KanbanProvider] Self-healed complexity for ${batchUpdates.length} plans (snapshot path)`);
                }
            }
```

- **Edge Cases Handled:**
  - **Missing plan file:** `getComplexityFromPlan` returns `'Unknown'` for non-existent files (line 873: `if (!fs.existsSync(resolvedPlanPath)) return 'Unknown'`). The `parsed === 'Low' || parsed === 'High'` guard ensures we never write `'Unknown'` back, avoiding a no-op DB write.
  - **Already-resolved plans:** The `(r.complexity || 'Unknown') === 'Unknown'` filter ensures plans with `'Low'` or `'High'` in the DB are never re-parsed.
  - **DB write failure:** `updateMetadataBatch()` returns `false` on failure and logs the error. The in-memory override map still populates the current render correctly, so the board shows the right value even if persistence fails (it will self-heal again on the next refresh).
  - **Empty planFile:** The `&& r.planFile` / `&& c.planFile` filter skips cards with no plan file path.

### Change 2: Fix sync pipeline to parse complexity from plan files
#### [MODIFY] `src/services/KanbanMigration.ts`
- **Context:** `syncPlansMetadata()` (lines 99–150) processes snapshot rows for existing plans. When `row.complexity` is not `'Low'` or `'High'` (i.e. `'Unknown'`), it passes `complexity: undefined` to `updateMetadataBatch()`, which then skips the complexity column in the SQL UPDATE. This is the root cause — the sync pipeline never resolves `'Unknown'` values.
- **Logic:**
  1. Add an optional `resolveComplexity` callback parameter to `syncPlansMetadata()`.
  2. For existing plans where `row.complexity` is neither `'Low'` nor `'High'`, call the resolver if provided.
  3. If the resolver returns `'Low'` or `'High'`, pass that value. Otherwise pass `undefined` (preserving existing DB value).
  4. This keeps `KanbanMigration` decoupled from `KanbanProvider` — no circular import.
- **Implementation:**

Replace the method signature at line 99:

```typescript
    public static async syncPlansMetadata(
        db: KanbanDatabase,
        workspaceId: string,
        snapshotRows: LegacyKanbanSnapshotRow[],
        resolveComplexity?: (planFile: string) => Promise<'Unknown' | 'Low' | 'High'>
    ): Promise<boolean> {
```

Replace the `for` loop body at lines 117–129:

```typescript
            for (const row of snapshotRows) {
                if (!existingIds.has(row.sessionId)) {
                    newRows.push(row);
                } else {
                    let resolvedComplexity: 'Unknown' | 'Low' | 'High' | undefined;
                    if (row.complexity === 'Low' || row.complexity === 'High') {
                        resolvedComplexity = row.complexity;
                    } else if (resolveComplexity) {
                        const parsed = await resolveComplexity(row.planFile);
                        resolvedComplexity = (parsed === 'Low' || parsed === 'High') ? parsed : undefined;
                    }
                    metadataUpdates.push({
                        sessionId: row.sessionId,
                        topic: row.topic,
                        planFile: row.planFile,
                        complexity: resolvedComplexity
                    });
                }
            }
```

- **Edge Cases Handled:**
  - **No resolver provided:** When `resolveComplexity` is `undefined`, behavior is identical to current code — complexity stays `undefined` and `updateMetadataBatch` skips the column.
  - **Resolver returns 'Unknown':** The `(parsed === 'Low' || parsed === 'High') ? parsed : undefined` guard ensures we never pass `'Unknown'` as a value, which would be a no-op in `updateMetadataBatch` anyway (its `if` guard on line 377 only writes `'Low'` or `'High'`).
  - **Resolver throws:** `getComplexityFromPlan()` has a top-level try/catch that returns `'Unknown'` on any error (lines 975–977). The `await` in the loop will not throw.

### Change 3: Wire the resolver into the sync call site
#### [MODIFY] `src/services/KanbanProvider.ts`
- **Context:** Wherever `KanbanProvider` calls `KanbanMigration.syncPlansMetadata()`, it must now pass the complexity resolver callback as the fourth argument.
- **Logic:** Find all call sites of `KanbanMigration.syncPlansMetadata` in `KanbanProvider.ts`. Add `(planFile) => this.getComplexityFromPlan(resolvedWorkspaceRoot, planFile)` as the fourth argument.
- **Implementation:**

At each call site, change:

```typescript
await KanbanMigration.syncPlansMetadata(db, workspaceId, snapshotRows);
```

to:

```typescript
await KanbanMigration.syncPlansMetadata(db, workspaceId, snapshotRows,
    (planFile) => this.getComplexityFromPlan(resolvedWorkspaceRoot, planFile)
);
```

- **Edge Cases Handled:**
  - **`resolvedWorkspaceRoot` scope:** The resolver captures `resolvedWorkspaceRoot` from the enclosing method via closure, ensuring plan paths are resolved relative to the correct workspace.

### Change 4: Verify `updateMetadataBatch()` — no change needed
#### [VERIFY] `src/services/KanbanDatabase.ts`
- **Context:** `updateMetadataBatch()` (lines 364–396) already correctly branches on `u.complexity === 'Low' || u.complexity === 'High'` at line 377. When complexity is `'Low'` or `'High'`, it writes the value. When complexity is `undefined` or `'Unknown'`, it omits the column (preserving the existing DB value). This is the correct behavior.
- **Logic:** No code change required. The existing guard prevents `'Unknown'` from overwriting a known value, and the upstream fixes (Changes 1–3) now ensure real parsed values are supplied.
- **Implementation:** No code change.
- **Edge Cases Handled:** N/A — existing behavior verified correct.

## Verification Plan
### Automated Tests
- Run `npm run compile` to verify TypeScript compilation succeeds with no type errors after all changes.
- Run `npm run lint` (if configured) to verify no linting regressions.
- Create a plan file with `### Complex / Risky\n- None` content and verify that `getComplexityFromPlan()` returns `'Low'`.
- Insert a plan into the test DB with `complexity: 'Unknown'`, trigger `_refreshBoardImpl()`, and verify the DB row updates to `'Low'` or `'High'` based on the plan file content.
- Verify that a plan with `complexity: 'High'` in the DB is NOT downgraded by `syncPlansMetadata()`.

### Manual Integration Tests
1. **Reproduce the bug (before fix):** Open the Kanban board. Find a plan showing gray "Unknown" complexity. Open the plan file — confirm it has a Complexity Audit section with "### Complex / Risky: - None" or a "Send it to the Coder" recommendation. Confirm the board badge shows gray "Unknown" while the review panel shows "Low".
2. **Verify the fix (after fix):** Reload the VS Code window to trigger a fresh `_refreshBoardImpl()`. The plan that was "Unknown" should now show the correct green "Low" or red "High" badge. Check the console for the `[KanbanProvider] Self-healed complexity for N plans` log message.
3. **Verify idempotency:** Refresh the board again. Confirm no re-parsing occurs (no self-heal log message on second refresh). All cards retain their resolved complexity.
4. **Verify Manual Override precedence:** Set a manual complexity override via the review panel dropdown (e.g. set a "Low" plan to "High"). Refresh the board. Confirm the override sticks and is not overwritten by file parsing (manual overrides write directly to DB via `updateComplexity()` and result in `'High'` — not `'Unknown'`).
5. **Verify deleted plan file handling:** Delete a plan file from disk (leave the DB row). Refresh the board. Confirm the card remains "Unknown" (not crashed, not incorrectly set to Low/High).
6. **Verify sync pipeline (Changes 2–3):** Trigger a plan sync. Confirm that existing plans with `'Unknown'` complexity get resolved during sync.
