# Bug Diagnosis: Low Complexity Plan Routed to Lead + "Session File Not Found" Error

**Reported:** 2026-03-29  
**Severity:** High (breaks kanban routing and workflow triggering)  
**Reporter:** patrickvuleta

---

## Bug Summary

When moving a **low complexity** plan from the "PLANNED" column, the system:
1. **Incorrectly routed** the plan to the "lead coder" column instead of the "coder" column
2. **Threw error** "Session file not found" instead of triggering the agent prompt
3. The user expected the system to be migrated away from session files (ongoing SQLite migration)

---

## Symptoms

- Plan complexity: **Low** (per user report)
- Expected behavior: Route to **coder** column + trigger prompt
- Actual behavior: Routed to **lead coder** column + error "session file not found"
- Error location: `TaskViewerProvider.ts` line 7764

---

## Root Cause Analysis

**CRITICAL:** The SQLite migration is **INCOMPLETE AND MUST BE FINISHED IMMEDIATELY**. Leaving migrations in a half-done state is **COMPLETELY UNACCEPTABLE** and breaks core functionality. The `feature_plan_20260328_131128_finish_sqlite_migration.md` explicitly lists the problematic code as **"TECH-DEBT filesystem fallback"** - meaning it was *known* to be broken and *scheduled* for removal, but the work was abandoned.

**This is not acceptable.** When a migration is started, it **must** be completed. Half-migrated systems create data integrity bugs, broken workflows, and user-facing errors. The code below should have been removed weeks ago.

### Issue 1: Deliberately Unfinished Migration (TECH-DEBT)

**Location:** `src/services/TaskViewerProvider.ts:7760-7766` - Listed as **R1** in migration plan to remove

```typescript
// 1. Get Plan File Path from Session
const sessionPath = path.join(resolvedWorkspaceRoot, '.switchboard', 'sessions', `${sessionId}.json`);
if (!fs.existsSync(sessionPath)) {
    clearDispatchLock();
    vscode.window.showErrorMessage(`Session file not found: ${sessionId}`);
    return false;
}
```

**Problem:** This code path was **explicitly identified** as migration item R1 to remove. It was not removed. The migration was abandoned mid-process, leaving the system in a broken dual-state where database-only plans cannot be dispatched.

**Impact:** Plans that exist in the database but lack a session JSON file on disk **cannot be dispatched**. This breaks the kanban workflow for any plan created after the migration started.

---

## Investigation Steps

### Step 1: Verify the affected plan's data sources
```bash
# Check if plan exists in database
sqlite3 .switchboard/kanban.db "SELECT session_id, kanban_column, complexity FROM plans WHERE plan_file LIKE '%dynamic_complexity_routing%'"

# Check if session file exists
ls -la .switchboard/sessions/ | grep <session_id>

# Check complexity stored in plan file vs database
grep -i "complexity" .switchboard/plans/feature_plan_20260329_dynamic_complexity_routing_toggle.md
```

### Step 2: Trace the dispatch flow
1. Find the `triggerAgentFromKanban` command registration
2. Trace how it calls into `TaskViewerProvider.ts`
3. Identify why it's not using `SessionActionLog._hydrateRunSheet()` (which has DB fallback)

### Step 3: Identify all direct session file accesses
```bash
# Find all direct filesystem checks for session files
grep -rn "sessions.*\.json" src/services/ --include="*.ts"
grep -rn "fs\.existsSync.*session" src/services/ --include="*.ts"
```

### Step 4: Check complexity source of truth
```bash
# Check where complexity is stored
grep -rn "getComplexityFromPlan" src/services/ --include="*.ts"

# Verify if complexity is in DB schema
grep -rn "complexity" src/services/KanbanDatabase.ts
```

---

## Proposed Fixes (MANDATORY - NO EXCUSES)

### Fix 1: Complete the Migration Immediately
**File:** `src/services/TaskViewerProvider.ts`  
**Action:** Execute migration plan `feature_plan_20260328_131128_finish_sqlite_migration.md` item **R1** immediately. Replace the session file check with DB-first lookup via `KanbanDatabase.getPlanBySessionId()`.

**This is not optional.** The migration plan already exists. Execute it.

### Fix 2: Remove All Remaining Session File Dependencies
**Files:** All files listed in migration plan items R1-R6 and C1-C5  
**Action:** Complete the full migration. Do not leave any "fallback" code paths that check for session files. The database is the source of truth.

### Fix 3: Add Complexity Routing Verification
**File:** `src/services/KanbanProvider.ts`  
**Action:** Add logging to prove complexity is being read from the database correctly. If complexity routing fails, it should fail loudly with a clear error, not silently default to 'lead'.

---

## Consequences of Further Delay

Every day this migration remains incomplete:
- Users experience broken kanban workflows
- Data integrity issues between DB and filesystem
- More technical debt accumulates
- Future development is blocked on a broken foundation

**FINISH THE MIGRATION. TODAY.**

---

## Related Plans

1. **Consolidate Session Files into DB** (`feature_plan_20260327_084057_consolidate_session_files_into_db.md`) - Ongoing migration this bug is blocking
2. **Dynamic Complexity Routing Toggle** (`feature_plan_20260329_dynamic_complexity_routing_toggle.md`) - The plan that experienced this bug
3. **Finish SQLite Migration** (`feature_plan_20260328_131128_finish_sqlite_migration.md`) - Related migration work

---

## Success Criteria

- [ ] Low complexity plans route to `coder` column, not `lead`
- [ ] Plan dispatch works without requiring session JSON files to exist
- [ ] "Session file not found" error no longer occurs for DB-only plans
- [ ] Complexity is read consistently from a single source of truth

---

## Notes

The user correctly identified that the system should have moved away from session files. This bug confirms the migration is **incomplete** - some code paths still require session files even when the plan exists in the database.

**Urgency:** High - This blocks the kanban workflow for any plan that doesn't have a corresponding session file on disk.

---

## Reviewer Pass — 2026-03-29

### Stage 1: Grumpy Principal Engineer Review

> *Adjusts reading glasses, sighs theatrically*

Right. Let me tell you what I found rummaging through this 9,500-line monolith at 2 AM because somebody thought "we'll finish the migration later" was a valid engineering strategy.

---

**FINDING 1 — CRITICAL: The "Session File Not Found" Error Is Fixed, But The Routing Bug Was NOT** 

Somebody fixed the **symptom** (the session file check at the old line 7760-7766) by replacing it with a proper DB lookup at `TaskViewerProvider.ts:7474-7487`. Good. Gold star. The `"Session file not found"` string no longer exists anywhere in the codebase.

But the **complexity routing bug** — the actual reason low-complexity plans ended up at "lead" — was *completely ignored*.

Here's the kill chain, which I had to trace through **four files** because apparently nobody documents their data flow:

1. `KanbanProvider.ts:1157` — `_resolveComplexityRoutedRole()` calls `log.getRunSheet(sessionId)`
2. `SessionActionLog.ts:628-629` — `getRunSheet()` calls `_hydrateRunSheet(sessionId)` 
3. `SessionActionLog.ts:438-443` — `_hydrateRunSheet()` calls `db.getRunSheet(sessionId)` 
4. `KanbanDatabase.ts:1150-1152` — `getRunSheet()` calls `getPlanEvents()` and **returns null if events.length === 0**

Do you see it? A plan with **zero events** in `plan_events` causes the **entire hydration chain** to return `null`. Then `_resolveComplexityRoutedRole` hits `if (!sheet?.planFile)` → **silently returns `'lead'`**. No warning. No log. Just… lead. For a Low-complexity plan.

The plan *exists in the `plans` table* with a valid `planFile` and `complexity = 'Low'`. But the routing code never looks there. It goes through the run-sheet/events pipeline, fails, and defaults to lead. This is a **data flow short-circuit that silently produces wrong routing**.

> **Verdict: CRITICAL.** This was the actual root cause of the reported bug. Fixed in this review pass.

---

**FINDING 2 — MAJOR: No Logging in `_resolveComplexityRoutedRole` (Silent Failure to Lead)**

`KanbanProvider.ts:1157-1165` — When `getRunSheet` returned null, the function silently returned `'lead'`. No `console.warn`, no `console.log`, nothing. The user saw the wrong column and had to file a bug report to discover the system was broken. 

Fix 3 in this plan says "Add logging to prove complexity is being read from the database correctly. If complexity routing fails, it should fail loudly." The self-healing logging at lines 432, 575 and the DB error logging at 991 exist, but the **actual routing decision** — the one that determines where a plan goes — was completely silent.

> **Verdict: MAJOR.** Fixed in this review pass — routing decision now logs complexity and role.

---

**FINDING 3 — NIT: Legacy Session File Cleanup Code (5019-5090)**

`TaskViewerProvider.ts:5019-5090` still reads `.json` files from the sessions directory, parses them, and quarantines orphans. This is labeled "Legacy cleanup" in the comments. It's not blocking dispatch — it only runs during reconciliation. But it's 70 lines of filesystem-scanning code for a format that's supposed to be deprecated.

> **Verdict: NIT.** Not causing bugs, but adds maintenance burden. Defer removal to a dedicated cleanup task.

---

**FINDING 4 — NIT: `_resolveComplexityRoutedRole` Does Not Respect `_dynamicComplexityRoutingEnabled` Toggle**

`KanbanProvider.ts:1583-1608` — The `moveForward` handler for `PLAN REVIEWED` always calls `_partitionByComplexityRoute` regardless of whether `_dynamicComplexityRoutingEnabled` is true. Meanwhile, `_generateBatchExecutionPrompt` at line 656 **does** check the toggle, treating all plans as high-complexity when disabled.

This means the toggle doesn't fully disable complexity routing — it only affects prompt generation, not column routing. The behavior may be intentional (the toggle controls prompt style, not destination), but it's undocumented.

> **Verdict: NIT.** Potential user confusion, but not causing the reported bug. Document the intended behavior.

---

### Stage 2: Balanced Synthesis

| Finding | Severity | Action | Status |
|---------|----------|--------|--------|
| F1: Routing defaults to 'lead' for plans without events | CRITICAL | Replace `getRunSheet` with `getPlanBySessionId` DB-first lookup | ✅ Fixed |
| F2: Silent failure — no logging in routing decision | MAJOR | Add `console.warn` on fallback, `console.log` on routing result | ✅ Fixed |
| F3: Legacy session file cleanup code | NIT | Defer to dedicated migration cleanup task | Deferred |
| F4: Toggle doesn't affect column routing | NIT | Document intended behavior | Deferred |

### Success Criteria Evaluation

- [x] **Low complexity plans route to `coder` column, not `lead`** — Fixed. `_resolveComplexityRoutedRole` now queries `plans` table directly via `getPlanBySessionId`, bypassing the events-dependent run sheet path.
- [x] **Plan dispatch works without requiring session JSON files to exist** — Already fixed prior to this review. `TaskViewerProvider.ts:7474-7487` uses DB-first lookup.
- [x] **"Session file not found" error no longer occurs for DB-only plans** — Confirmed. The error string does not exist in the codebase. Replaced with `"Plan not found in database for session: ${sessionId}"`.
- [x] **Complexity is read consistently from a single source of truth** — Improved. `getComplexityFromPlan` checks: manual override → DB → plan file metadata → agent recommendation → audit section. The routing path now feeds into this same function via DB-resolved `planFile`.

### Files Changed

| File | Change |
|------|--------|
| `src/services/KanbanProvider.ts:1157-1190` | Rewrote `_resolveComplexityRoutedRole()`: DB-first `getPlanBySessionId` lookup for planFile, run-sheet fallback, added warn/info logging for routing decisions |

### Validation

- `npx tsc --noEmit` — **PASS** (zero errors, before and after)

### Remaining Risks

1. **Plans with no `planFile` in the DB** — still default to 'lead'. This is correct behavior (can't determine complexity without a plan file), but should be monitored.
2. **Legacy session file cleanup** — ~70 lines in TaskViewerProvider.ts (5019-5090) still scan the filesystem. Not blocking, but adds maintenance burden.
3. **`_dynamicComplexityRoutingEnabled` toggle scope** — only affects prompt generation, not column routing. May confuse users who expect the toggle to disable all complexity-based behavior.
