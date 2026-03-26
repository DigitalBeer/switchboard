# Remove "MERGE ALL" Sidebar Button

## Goal
Completely remove the "MERGE ALL" sidebar button from the Switchboard extension UI and all supporting backend logic. This button merges every open plan into a single batch file — a destructive, irreversible operation that archives all source plans. It is dangerous because a single mis-click wipes the user's active plan set. The feature is now fully superseded by the kanban prompt bundling system, which offers selective, non-destructive plan composition. Removing this code eliminates the risk surface entirely and simplifies the sidebar action bar.

## User Review Required
No product-level decisions are needed. This is a pure removal of a deprecated, dangerous feature. All seven code locations have been audited and confirmed to have no downstream consumers or shared utility beyond the merge-all flow.

## Complexity Audit

**Manual Complexity Override:** Low


### Routine
- **HTML button removal** (lines 1281–1282 in `implementation.html`): Delete the `<button id="btn-merge-all-plans">` element. The surrounding `<div>` contains sibling buttons (RECOVER, DELETE) that remain untouched.
- **Variable declaration removal** (line 1500): Delete `const mergeAllPlansBtn = document.getElementById('btn-merge-all-plans');`. No other code references this variable after the other removals are applied.
- **Disable-state logic removal** (lines 1530–1532): Delete the `if (mergeAllPlansBtn)` guard inside `updatePlanActionStates()`. The enclosing function continues to manage `copyPlanLinkBtn` and other buttons.
- **Click listener removal** (lines 1907–1911): Delete the `if (mergeAllPlansBtn)` block that posts the `mergeAllPlans` message. Adjacent listeners (`copyPlanLinkBtn`, etc.) are unaffected.
- **CSS rule removal** (lines 167–171): Delete the `.icon-btn.merge:hover:not(:disabled)` rule. No other element uses the `.merge` modifier class.
- **Message handler case removal** (lines 3004–3006 in `TaskViewerProvider.ts`): Delete the `case 'mergeAllPlans'` switch arm. The surrounding switch remains intact with its other cases.

### Complex / Risky
- None.


## Edge-Case & Dependency Audit
1. **No other callers**: `_handleMergeAllPlans` is private and called exclusively from the webview message handler's `case 'mergeAllPlans'` branch. Removing both the case and the method is safe.
2. **No shared CSS class consumers**: The `.icon-btn.merge` CSS class is applied only to the `#btn-merge-all-plans` button. A grep confirms zero other usages in the codebase.
3. **No test coverage to update**: There are no existing unit or integration tests for the merge-all flow (it was a UI-only feature with no test harness).
4. **No keybinding or command palette entry**: The merge-all action is triggered exclusively via the sidebar button click → `postMessage`. There is no `package.json` command registration or keybinding to clean up.
5. **Existing batch plan files**: Previously merged batch files (`feature_plan_batch_*.md`) in `.switchboard/plans/` will remain on disk as inert Markdown. They are not affected by this removal and can be manually deleted by users if desired.
6. **`updatePlanActionStates()` integrity**: After removing the `mergeAllPlansBtn` guard, the function still correctly manages `copyPlanLinkBtn.disabled`. No other logic in this function depends on `mergeAllPlansBtn`.

## Adversarial Synthesis

### Grumpy Critique
Oh wonderful, another "let's just delete it" plan. I've seen this movie before — someone yanks 125 lines of backend code and three months later we get a P1 because some forgotten code path was quietly depending on the `batch-merge` workflow event type, or some analytics dashboard was keyed on the `merge_plans` operation string, and now it's throwing null refs into the void.

Did anyone *actually* grep the entire codebase for the string `'batch-merge'`? For `'merge_plans'`? For `mergedFrom`? Because that `_handleMergeAllPlans` method writes run-sheet events with `workflow: 'batch-merge'` and logs telemetry with `operation: 'merge_plans'`. If any reporting, migration, or analytics code downstream reads those event types, you've just created a ghost dependency.

And while we're at it — the plan says "no test coverage to update" like that's a *feature*. It's not. It means nobody ever tested the removal path either. You're flying blind on whether the `updatePlanActionStates` function still renders correctly after gutting one of its branches. What if there's a CSS layout shift when that button disappears? The button bar had three items; now it has two. Did anyone check that the flexbox doesn't collapse weirdly?

Also, the "pure removal" confidence is adorable. The method calls `_updatePlanRegistryStatus` with `'archived'` — what if some future code expected merged plans to exist in the registry with that status? You're not just removing a button; you're removing an entire workflow that wrote persistent state. Existing `feature_plan_batch_*.md` files will reference `sessionId`s that came from `batch_${Date.now()}` — are those orphaned run sheets going to confuse the recovery UI?

Finally: no rollback plan. No feature flag. Just "delete it and pray." Classic.

### Balanced Response
The critique raises legitimate concerns that deserve verification, but most are addressable with targeted checks:

1. **`batch-merge` and `merge_plans` downstream consumers**: Valid concern. The coder should grep for `'batch-merge'` and `'merge_plans'` across the entire codebase before deleting. If any analytics, migration, or reporting code references these strings, those references need to be catalogued and addressed. However, given that this is an extension (not a service with external consumers), the blast radius is contained.

2. **CSS layout after button removal**: The sidebar button bar uses flexbox with `gap` spacing. Removing one flex child simply reflows the remaining children. This is standard CSS behavior and unlikely to cause a layout break, but a quick visual inspection during manual testing will confirm.

3. **Orphaned batch run sheets**: Existing `feature_plan_batch_*.md` files and their run-sheet entries will remain in the session log. The recovery UI already handles arbitrary run sheets gracefully (it reads whatever exists). No new orphan-handling code is needed, but the manual test should verify the recovery modal still renders cleanly.

4. **No feature flag**: For a pure removal of a deprecated feature with no external API surface, a feature flag would add unnecessary complexity. The change is fully reversible via `git revert`.

5. **No tests**: The absence of existing tests means there are no tests to break, but it also means we rely on manual verification. The verification plan below covers the critical paths.

## Proposed Changes

### Frontend — Sidebar Button Bar
#### [DELETE] `src/webview/implementation.html` — Button HTML (lines 1281–1282)
- **Context:** The `#btn-merge-all-plans` button sits inside the `.plan-actions` toolbar alongside the RECOVER and DELETE buttons.
- **Logic:** Remove the entire `<button>` element. The enclosing `<div>` and sibling buttons are untouched.
- **Implementation:** Delete lines 1281–1282:
  ```html
  <button id="btn-merge-all-plans" class="icon-btn merge" title="Merge all plans into a single file"
      aria-label="Merge all plans">MERGE ALL</button>
  ```
- **Edge Cases Handled:** No adjacent whitespace issues; the closing `</div>` on line 1283 remains valid.

### Frontend — CSS Styling
#### [DELETE] `src/webview/implementation.html` — Merge hover style (lines 167–171)
- **Context:** The `.icon-btn.merge` hover rule provides the cyan glow effect unique to the merge button.
- **Logic:** Remove the entire CSS rule block. No other element uses the `.merge` modifier.
- **Implementation:** Delete lines 167–171:
  ```css
  .icon-btn.merge:hover:not(:disabled) {
      color: var(--accent-cyan);
      border-color: color-mix(in srgb, var(--accent-cyan) 50%, transparent);
      box-shadow: 0 0 8px color-mix(in srgb, var(--accent-cyan) 20%, transparent);
  }
  ```
- **Edge Cases Handled:** The preceding `.icon-btn.delete` rule (ends line 165) and following `.icon-btn:disabled` rule (line 173) remain syntactically valid with a blank line between them.

### Frontend — JavaScript Variable Declaration
#### [DELETE] `src/webview/implementation.html` — Variable (line 1500)
- **Context:** `mergeAllPlansBtn` is declared alongside other `getElementById` calls in the script's initialization block.
- **Logic:** Remove the `const` declaration. After all other merge-related removals, zero references to this variable remain.
- **Implementation:** Delete line 1500:
  ```javascript
  const mergeAllPlansBtn = document.getElementById('btn-merge-all-plans');
  ```
- **Edge Cases Handled:** Adjacent declarations (`copyPlanLinkBtn` on line 1499, `recoverPlansModal` on line 1502) are independent statements unaffected by this deletion.

### Frontend — JavaScript Disable Logic
#### [MODIFY] `src/webview/implementation.html` — `updatePlanActionStates()` (lines 1530–1532)
- **Context:** The `updatePlanActionStates()` function manages the disabled state of plan action buttons. The `mergeAllPlansBtn` guard is one of its branches.
- **Logic:** Remove the `if (mergeAllPlansBtn)` block (lines 1530–1532). The function continues to manage `copyPlanLinkBtn.disabled` on lines 1527–1529.
- **Implementation:** Delete lines 1530–1532:
  ```javascript
  if (mergeAllPlansBtn) {
      mergeAllPlansBtn.disabled = !currentRunSheets || currentRunSheets.length === 0;
  }
  ```
- **Edge Cases Handled:** The closing `}` of `updatePlanActionStates()` on line 1533 remains correct.

### Frontend — JavaScript Click Listener
#### [DELETE] `src/webview/implementation.html` — Event listener (lines 1907–1911)
- **Context:** The click listener posts a `mergeAllPlans` message to the extension host when the button is clicked.
- **Logic:** Remove the entire `if (mergeAllPlansBtn)` block. The preceding listener block (ends line 1904) and following `copyPlanLinkBtn` listener (line 1913) are unaffected.
- **Implementation:** Delete lines 1907–1911:
  ```javascript
  if (mergeAllPlansBtn) {
      mergeAllPlansBtn.addEventListener('click', () => {
          vscode.postMessage({ type: 'mergeAllPlans' });
      });
  }
  ```
- **Edge Cases Handled:** No dangling references; `mergeAllPlansBtn` variable is also being removed.

### Backend — Message Handler
#### [DELETE] `src/services/TaskViewerProvider.ts` — Switch case (lines 3004–3006)
- **Context:** The webview message handler switch statement routes incoming messages to handler methods. The `mergeAllPlans` case dispatches to `_handleMergeAllPlans()`.
- **Logic:** Remove the three-line case block. The surrounding cases (`createDraftPlanTicket` above, `getRecoverablePlans` below) remain intact.
- **Implementation:** Delete lines 3004–3006:
  ```typescript
  case 'mergeAllPlans':
      await this._handleMergeAllPlans();
      break;
  ```
- **Edge Cases Handled:** Switch fall-through is impossible since adjacent cases have their own `break` statements.

### Backend — Handler Method
#### [DELETE] `src/services/TaskViewerProvider.ts` — `_handleMergeAllPlans()` (lines 6226–6351)
- **Context:** This is the 125-line private async method that implements the entire merge-all workflow: reads active sheets, concatenates plan content, creates a merged run sheet, archives sources, syncs the sidebar, and opens the result.
- **Logic:** Remove the entire method definition. It is private and its sole caller (the switch case above) is also being removed.
- **Implementation:** Delete from line 6226 (`private async _handleMergeAllPlans() {`) through line 6351 (the closing `}` of the method).
- **Edge Cases Handled:** The method calls shared helpers (`_resolveWorkspaceRoot`, `_getSessionLog`, `_activateWorkspaceContext`, `_isOwnedActiveRunSheet`, `_syncFilesAndRefreshRunSheets`, `_registerPlan`, `_updatePlanRegistryStatus`, `_getPlanIdForRunSheet`, `_getOrCreateWorkspaceId`, `_logEvent`) — none of these are removed. The next method (`_findReviewFilesForSession` on line 6353) becomes the new occupant of this position in the class.

## Verification Plan

### Automated Tests
1. **Build check**: Run `npm run compile` (or the project's build command) and confirm zero TypeScript compilation errors. This validates that no remaining code references the deleted method or variable.
2. **Grep audit**: Run `grep -rn 'mergeAllPlans\|_handleMergeAllPlans\|btn-merge-all-plans\|icon-btn\.merge\|batch-merge\|merge_plans' src/` and confirm zero matches. This catches any stale references the coder might have missed.

### Manual Tests
1. **Sidebar renders correctly**: Open the Switchboard sidebar in VS Code. Confirm the button bar shows only RECOVER and DELETE (no MERGE ALL). Verify no layout collapse or spacing anomaly.
2. **Button states still work**: Load a workspace with plans. Verify RECOVER and DELETE buttons enable/disable correctly based on plan selection. Confirm `updatePlanActionStates()` works without errors in the developer console.
3. **Recovery modal unaffected**: Click RECOVER and confirm the recovery modal opens and lists recoverable plans normally, including any previously-merged batch plans.
4. **No console errors**: Open the VS Code Developer Tools console. Navigate the sidebar, switch plans, and perform normal operations. Confirm zero JavaScript errors related to `mergeAllPlansBtn` or `mergeAllPlans`.
5. **Existing batch files**: If any `feature_plan_batch_*.md` files exist from prior merges, confirm they still appear in the plan dropdown and can be opened/viewed normally.

## Recommendation
**Send to Coder.** This is a straightforward deletion across two files with no architectural decisions, no new code to write, and no ambiguous requirements. All seven removal targets are precisely identified with exact line numbers. A standard coder can execute this in a single pass with high confidence.

## Reviewer Pass

**Reviewer:** Copilot CLI (Principal Engineer review)
**Date:** 2026-03-26
**Verdict:** ✅ PASS — All 7 removal targets confirmed deleted. No code fixes required.

### Stage 1 — Grumpy Principal Engineer Review

All 7 plan-specified removal targets were verified absent from the codebase:

| # | Target | File | Status |
|---|--------|------|--------|
| 1 | `<button id="btn-merge-all-plans">` HTML element | implementation.html | ✅ Removed |
| 2 | `.icon-btn.merge:hover:not(:disabled)` CSS rule | implementation.html | ✅ Removed |
| 3 | `const mergeAllPlansBtn = document.getElementById(...)` variable | implementation.html | ✅ Removed |
| 4 | `if (mergeAllPlansBtn)` disable guard in `updatePlanActionStates()` | implementation.html | ✅ Removed |
| 5 | `if (mergeAllPlansBtn) { addEventListener` click listener | implementation.html | ✅ Removed |
| 6 | `case 'mergeAllPlans':` switch arm | TaskViewerProvider.ts | ✅ Removed |
| 7 | `private async _handleMergeAllPlans()` method (~125 lines) | TaskViewerProvider.ts | ✅ Removed |

**Collateral damage check:** None detected.
- RECOVER and DELETE buttons remain intact in the `.plan-actions` toolbar.
- `updatePlanActionStates()` still correctly manages `copyPlanLinkBtn.disabled`.
- `copyPlanLinkBtn` click listener intact.
- CSS rules for `.icon-btn.recover` and `.icon-btn.delete` intact.
- Adjacent switch cases (`createDraftPlanTicket`, `getRecoverablePlans`, `restorePlan`) intact.
- `_handleClaimPlan()` and `_findReviewFilesForSession()` methods intact around the deletion site.

**Grep audit:** `grep -rn 'mergeAllPlans|_handleMergeAllPlans|btn-merge-all-plans|icon-btn\.merge|batch-merge|merge_plans' src/` → **0 matches** ✅

**Findings:** None. Zero CRITICAL, MAJOR, or NIT issues identified.

### Stage 2 — Balanced Synthesis

No findings to triage. The implementation is a clean, complete execution of all 7 removal targets with no collateral damage to surrounding code.

### Stage 3 — Code Fixes

No fixes required.

### Stage 4 — Verification Results

- **`npm run compile`**: ✅ Both webpack bundles compiled successfully (exit code 0, zero errors).
- **Grep audit**: ✅ Zero matches for all 6 search patterns across `src/`.

### Stage 5 — Summary

**Files changed:** `src/webview/implementation.html`, `src/services/TaskViewerProvider.ts`
**Remaining risks:**
- Existing `feature_plan_batch_*.md` files from prior merges remain on disk as inert Markdown (documented in plan as expected; no action needed).
- No automated test coverage for the removal (none existed before either). Manual sidebar verification recommended per the plan's manual test checklist.
**Status:** Implementation complete and verified. Ready for manual QA.
