# Reverse plan dropdown order - newest first

## Goal

Reverse the plan select sidebar dropdown (`<select id="run-sheet-select">` in `src/webview/implementation.html` line 1557) so that the newest plans appear at the top instead of the oldest. The single root cause is `ORDER BY updated_at ASC` in the `getBoard()` SQL query (`src/services/KanbanDatabase.ts` line 635), which needs to be flipped to `DESC`.

## Metadata
**Tags:** backend, database, UI
**Complexity:** Low

## User Review Required
> [!NOTE]
> The plan dropdown will now show newest plans first. The currently-selected plan will be preserved across refreshes.

## Complexity Audit

### Routine
- Change `ASC` to `DESC` in one SQL query (`src/services/KanbanDatabase.ts` line 635, inside the `getBoard()` method at lines 630-639). This is the single source of the dropdown's sort order.

### Complex / Risky
- None.

## Edge-Case & Dependency Audit

- **Race Conditions:** None — single SQL query change, no concurrent writes affected.
- **Security:** None — no user input involved in sort order.
- **Side Effects:** The dropdown's `selectedIndex = 0` fallback (`src/webview/implementation.html` line ~2875) will now select the NEWEST plan instead of the oldest when no prior selection exists. This is actually the desired behavior.
- **Dependencies & Conflicts:** No cross-plan conflicts. The "Fixing Kanban Duplicates" plan modifies `TaskViewerProvider.ts` and `KanbanDatabase.ts` but does NOT touch `getBoard()` or any sort order. Note: `getCompletedPlans()` (line 652-662) already uses `ORDER BY updated_at DESC`, so this change makes `getBoard()` consistent.

## Adversarial Synthesis

### Grumpy Critique

The original plan was vague to the point of being unhelpful:

- **"Files Likely Affected"** listed `src/services/PlanManager.ts` — a file that does not exist in the codebase.
- **"Open Questions"** were trivially answerable by reading the code: `getBoard()` returns rows sorted `ASC` by `updated_at`, the webview renders in received order with no additional sorting, and `_sortSheets()` (lines 7077-7091 in `TaskViewerProvider.ts`) already exists but is never called.
- **"Proposed Changes"** offered no specificity — "Identify the code", "Locate where", "Modify the sorting logic" are research tasks, not an implementation spec. The actual fix is a single 3-character edit (`ASC` → `DESC`).
- The plan did not trace the data flow: `_refreshRunSheets()` (line 7014) → `db.getBoard()` → `postMessage` → `renderRunSheetDropdown()` — none of these apply additional sorting, so the DB query is the only lever.

### Balanced Response

Despite the vagueness, the original plan correctly identified the symptom (oldest-first ordering) and the desired outcome (newest-first). The fix is genuinely trivial — a one-line SQL change — which means low risk regardless of how the plan was written. The existing `getCompletedPlans()` method already uses `DESC` ordering, confirming this pattern is established in the codebase. No new abstractions, utilities, or refactoring are needed.

## Proposed Changes

### Target 1: `src/services/KanbanDatabase.ts` line 635

**MODIFY:** Change `ORDER BY updated_at ASC` to `ORDER BY updated_at DESC` in the `getBoard()` method.

```typescript
// Before (line 635):
ORDER BY updated_at ASC

// After:
ORDER BY updated_at DESC
```

**Why this is the only change needed:**

1. `TaskViewerProvider._refreshRunSheets()` (line 7014-7016) calls `db.getBoard(workspaceId)` — the returned rows arrive in DB sort order.
2. The rows are mapped to `{ sessionId, topic, planFile, createdAt }` objects (lines 7030-7035) with no re-sorting.
3. The array is sent to the webview via `postMessage({ type: 'runSheets', sheets })` (line 7036).
4. The webview's `renderRunSheetDropdown()` (lines 2826-2881) iterates with `sheets.forEach(sheet => ...)` — no sorting applied, renders in received order.
5. Therefore, changing the SQL sort direction is sufficient to reverse the dropdown order end-to-end.

**Note:** `_sortSheets()` (lines 7077-7091 in `TaskViewerProvider.ts`) is an unused method that sorts DESC by `createdAt`. It does NOT need to be wired in — the DB-level fix is cleaner and avoids unnecessary in-memory sorting. It can be cleaned up in a separate task if desired.

## Verification Plan
- Open the plan select dropdown in the sidebar (`<select id="run-sheet-select">` at `src/webview/implementation.html` line 1557).
- Verify that the most recently created plans appear at the top of the list.
- Create a new plan and verify it immediately appears at the top of the dropdown.
- Confirm that older plans appear lower in the list.
- Ensure no duplicate entries or missing plans in the dropdown.
- Verify that switching between plans still works (the `change` event listener at lines 2882+ in `implementation.html`).
- Verify that the currently-selected plan is preserved across panel refreshes.

## Files Affected
- `src/services/KanbanDatabase.ts` — line 635: change `ORDER BY updated_at ASC` to `ORDER BY updated_at DESC` in `getBoard()`.

## Review Feedback

### Stage 1 — Grumpy Principal Engineer Review

*Sighs, adjusts reading glasses, peers at a one-line diff*

Oh, how DELIGHTFUL. A three-character change. Let me clear my calendar.

**FINDING 1 — NIT: Phantom Whitespace Change**
The diff shows the indentation of `[workspaceId]` changed from 14 spaces to 13 spaces. Was this intentional reformatting or did someone's editor betray them? It's harmless, but it means the diff is technically TWO changes, not one. I weep for the purity of atomic commits.

```diff
-             ORDER BY updated_at ASC`,
-             [workspaceId]    // 14-space indent
+             ORDER BY updated_at DESC`,
+            [workspaceId]     // 13-space indent
```

**FINDING 2 — NIT: Correct Query, Correct Method**
The change is in `getBoard()` (line ~635), which is indeed the sole source of dropdown ordering. Not `getCompletedPlans()` (already DESC), not `getAllPlans()`, not some rogue method. *Grudging approval.*

**FINDING 3 — NIT: Default Selection Behavior — Actually Improved**
After reordering, `selectedIndex = 0` in `renderRunSheetDropdown()` now selects the newest plan as default. This is actually *better* UX — the plan noted this correctly. No edge case here.

**FINDING 4 — VERIFIED: No Downstream Re-sorting**
- `_refreshRunSheets()`: passes DB rows through `.map()` with no sort. ✅
- `renderRunSheetDropdown()`: iterates with `forEach()`, no sort. ✅
- `_sortSheets()` (lines 7077-7091): EXISTS but is NEVER CALLED. Dead code. Not our problem today.

**FINDING 5 — VERIFIED: Selection Preservation**
`renderRunSheetDropdown()` stores `lastSelected = runSheetSelect.value` before rebuilding, then restores it if found. Reordering doesn't break this. ✅

**Overall Assessment:** The change is correct, complete, and introduces no regressions. I am *almost* disappointed.

### Stage 2 — Balanced Synthesis

**Actionable Items:** None. The implementation matches the plan exactly.

| # | Severity | Finding | Action |
|---|----------|---------|--------|
| 1 | NIT | Whitespace change on `[workspaceId]` indent (14→13 spaces) | Cosmetic only; no fix needed |
| 2 | PASS | Correct query targeted (`getBoard()`) | N/A |
| 3 | PASS | Default selection now newest plan | Desired behavior |
| 4 | PASS | No downstream re-sorting in pipeline | N/A |
| 5 | PASS | Selection preservation intact | N/A |

No CRITICAL or MAJOR issues found. No code fixes required.

## Reviewer Execution Update
- **Files inspected:** `src/services/KanbanDatabase.ts` (getBoard, getCompletedPlans), `src/services/TaskViewerProvider.ts` (_refreshRunSheets), `src/webview/implementation.html` (renderRunSheetDropdown)
- **Changes verified via:** `git diff HEAD~5 -- src/services/KanbanDatabase.ts`
- **Typecheck result:** `npx tsc --noEmit` — 1 pre-existing error in `KanbanProvider.ts:1472` (unrelated import path issue). No new errors introduced.
- **Code fixes applied:** None needed — implementation is correct as-is.

## Reviewer Verdict
- **PASS** ✅ — The single-line ORDER BY change (`ASC` → `DESC`) in `getBoard()` is correctly implemented. The sort order propagates cleanly through `_refreshRunSheets()` → `postMessage` → `renderRunSheetDropdown()` with no intermediate re-sorting. `getCompletedPlans()` already uses `DESC`, so this change establishes consistency. No regressions, no edge cases, no unintended side effects.
