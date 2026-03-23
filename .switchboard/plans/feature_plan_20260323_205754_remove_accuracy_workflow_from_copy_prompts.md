# Remove accuracy workflow from copy prompts

## Goal
When the "Copy Prompt" button is used on a low-complexity task to send that task to a coder agent via clipboard (IDE chat), the accuracy workflow instruction is appended to the prompt. The accuracy workflow (`accuracy.md` Step 1) calls `start_workflow(name: "accuracy")`, an MCP tool scoped to registered CLI terminal agents. IDE chat agents receiving clipboard prompts have no registered terminal, causing: `ERROR: Unknown targetAgent 'accuracy-session-cli-ban-title'. Must be a registered terminal or chat agent.`

**Fix:** Stop passing `accurateCodingEnabled: true` in clipboard/copy prompt code paths. Accuracy instructions must only be appended for prompts dispatched to CLI terminal agents (autoban, pair-programming terminal dispatch).

## User Review Required
> [!NOTE]
> After this change, accuracy mode will **no longer** appear in prompts copied to clipboard for IDE chat agents. It will continue to work for autoban terminal dispatch and pair-programming terminal dispatch. This is the intended behaviour — accuracy workflow requires MCP tools only available in CLI terminal sessions.

## Complexity Audit
### Band A — Routine
- **Change 1:** In `KanbanProvider._generateBatchExecutionPrompt()`, stop reading the `accurateCoding.enabled` setting and hardcode `accurateCodingEnabled: false` (or omit it; default is `false`).
- **Change 2:** In `TaskViewerProvider._handleCopyPlanLink()`, change `accurateCodingEnabled: this._isAccurateCodingEnabled()` to `accurateCodingEnabled: false`.
- **Change 3:** Rebuild compiled `.js` files via the project's build step.

### Band B — Complex / Risky
- None.

## Edge-Case & Dependency Audit
- **Race Conditions:** None. Prompt generation is synchronous string building. No shared mutable state involved.
- **Security:** No security impact. This only controls whether a text instruction is appended to a clipboard string.
- **Side Effects:** Autoban terminal dispatch (`TaskViewerProvider._buildAutobanPrompt`, `_dispatchWithPairProgrammingIfNeeded`, `KanbanProvider._dispatchWithPairProgrammingIfNeeded`) all build their own prompts independently and still pass `accurateCodingEnabled` from the VS Code setting. Those paths are **not affected** by this change.
- **Dependencies & Conflicts:** No active Kanban plans conflict. The plan "Consolidate enhance and challenge workflows" (`feature_plan_20260314_203543`) mentions accuracy in diffs but only in the context of column derivation (`deriveKanbanColumn`), not prompt generation — no overlap. The plan "CLI-BAN title should not change based on cli trigger switch" (`sess_1774259327566`, currently in CODER CODED) is unrelated despite the error message mentioning "cli-ban-title".

## Adversarial Synthesis

### Grumpy Critique
**MAJOR — You're removing accuracy from copy prompts, but are you SURE you've found every copy path?**
I count at least three distinct clipboard-write paths in `KanbanProvider`: `promptSelected`, `promptAll`, and the batch low-complexity button at line 1254. They all funnel through `_generateBatchExecutionPrompt` — fine. But `TaskViewerProvider._handleCopyPlanLink` is a completely separate code path with its own `buildKanbanBatchPrompt` call. If you only fix one and forget the other, you'll have the same bug on individual card copies. Show me receipts that BOTH paths are covered.

**MAJOR — What about the pair-programming card copy button?**
The pair-programming button in `KanbanProvider` (line 1520-1527) reads `accurateCodingEnabled` and passes it to `buildKanbanBatchPrompt('coder', ...)`. That prompt is NOT dispatched to a terminal — it's written to clipboard via `vscode.env.clipboard.writeText`. If accuracy is on, that clipboard prompt will also contain the broken accuracy instruction. Is THAT path in scope or not?

**NIT — The `.js` files are compiled artifacts.** Don't tell me to "manually update" them. Just say "rebuild" and move on. If the build step is broken, that's a separate problem.

### Balanced Response
Both MAJOR points are valid and addressed:

1. **Both copy paths are covered.** Change 1 targets `KanbanProvider._generateBatchExecutionPrompt()` (covers `promptSelected`, `promptAll`, and the batch button). Change 2 targets `TaskViewerProvider._handleCopyPlanLink()` (covers individual card copy). Both are clipboard-only paths.

2. **Pair-programming card copy button:** Examining `KanbanProvider` lines 1519-1527 — the coder prompt there IS written to clipboard but dispatched via `vscode.commands.executeCommand('switchboard.dispatchToCoderTerminal', coderPrompt)` at the final step. However, the lead prompt is written to clipboard. **Clarification:** The coder prompt in the pair-programming path goes to a terminal, so accuracy is correct there. The lead prompt goes to clipboard but uses role `'lead'`, and `withCoderAccuracyInstruction` only appends for `coder` role — so no issue.

3. **Build:** The `.js` files are webpack-compiled from `.ts` sources. Running the standard build (`npm run compile` or `npx webpack`) regenerates them. No manual JS edits needed.

## Proposed Changes

> [!IMPORTANT]
> **MAXIMUM DETAIL REQUIRED:** Complete code blocks with exact search/replace targets.

### Change 1: KanbanProvider — Remove accuracy from batch execution prompt
#### MODIFY `src/services/KanbanProvider.ts`
- **Context:** `_generateBatchExecutionPrompt()` is the shared prompt builder for all Kanban copy-to-clipboard batch operations (`promptSelected`, `promptAll`, batch low-complexity button). It currently reads the `accurateCoding.enabled` VS Code setting and passes it to `buildKanbanBatchPrompt`, which appends the accuracy workflow instruction for coder-role prompts. This instruction references MCP tools unavailable in IDE chat agents.
- **Logic:**
  1. Remove the line that reads `accurateCoding.enabled` from VS Code configuration.
  2. Remove `accurateCodingEnabled` from the options object passed to `buildKanbanBatchPrompt` (default is `false`).
- **Implementation:**

Find (lines 432–445):
```typescript
private _generateBatchExecutionPrompt(cards: KanbanCard[], workspaceRoot: string): string {
    const hasHighComplexity = cards.some(card => !this._isLowComplexity(card));
    const role = hasHighComplexity ? 'lead' : 'coder';
    const instruction = hasHighComplexity ? undefined : 'low-complexity';
    const accurateCodingEnabled = vscode.workspace.getConfiguration('switchboard').get<boolean>('accurateCoding.enabled', true);
    const pairProgrammingEnabled = this._autobanState?.pairProgrammingEnabled ?? false;
    const aggressivePairProgramming = this._autobanState?.aggressivePairProgramming ?? false;
    return buildKanbanBatchPrompt(role, this._cardsToPromptPlans(cards, workspaceRoot), {
        instruction,
        accurateCodingEnabled,
        pairProgrammingEnabled,
        aggressivePairProgramming
    });
}
```

Replace with:
```typescript
private _generateBatchExecutionPrompt(cards: KanbanCard[], workspaceRoot: string): string {
    const hasHighComplexity = cards.some(card => !this._isLowComplexity(card));
    const role = hasHighComplexity ? 'lead' : 'coder';
    const instruction = hasHighComplexity ? undefined : 'low-complexity';
    // Accuracy mode is NOT included in copy-to-clipboard prompts — it requires MCP tools
    // only available in CLI terminal sessions (autoban dispatch handles accuracy separately).
    const pairProgrammingEnabled = this._autobanState?.pairProgrammingEnabled ?? false;
    const aggressivePairProgramming = this._autobanState?.aggressivePairProgramming ?? false;
    return buildKanbanBatchPrompt(role, this._cardsToPromptPlans(cards, workspaceRoot), {
        instruction,
        pairProgrammingEnabled,
        aggressivePairProgramming
    });
}
```

- **Edge Cases Handled:** All three batch copy paths (`promptSelected`, `promptAll`, batch button at line 1254) route through this method. Terminal dispatch paths (`_dispatchWithPairProgrammingIfNeeded`) build their own prompt independently and are unaffected.

### Change 2: TaskViewerProvider — Remove accuracy from individual card copy
#### MODIFY `src/services/TaskViewerProvider.ts`
- **Context:** `_handleCopyPlanLink()` generates the clipboard prompt for individual card "Copy Prompt" buttons. It passes `accurateCodingEnabled: this._isAccurateCodingEnabled()` to `buildKanbanBatchPrompt`, causing the same broken accuracy instruction to appear in clipboard prompts.
- **Logic:**
  1. Change `accurateCodingEnabled: this._isAccurateCodingEnabled()` to `accurateCodingEnabled: false`.
- **Implementation:**

Find (lines 5760–5764):
```typescript
let textToCopy = buildKanbanBatchPrompt(role, [plan], {
    instruction: resolvedInstruction,
    includeInlineChallenge,
    accurateCodingEnabled: this._isAccurateCodingEnabled()
});
```

Replace with:
```typescript
// Accuracy mode excluded from clipboard prompts — requires MCP tools only in CLI terminals
let textToCopy = buildKanbanBatchPrompt(role, [plan], {
    instruction: resolvedInstruction,
    includeInlineChallenge,
    accurateCodingEnabled: false
});
```

- **Edge Cases Handled:** This is the only individual-card copy path. Other `_isAccurateCodingEnabled()` call sites in `TaskViewerProvider` are for autoban/terminal dispatch and remain unchanged.

## Verification Plan
### Automated Tests
- Run `npx webpack` (or `npm run compile`) — confirm clean build with no TypeScript errors.
- Grep the compiled `KanbanProvider.js` for `accurateCodingEnabled` — should only appear in `_dispatchWithPairProgrammingIfNeeded`, NOT in `_generateBatchExecutionPrompt`.
- Grep the compiled `TaskViewerProvider.js` for `accurateCodingEnabled` in `_handleCopyPlanLink` — should show `false`, not `this._isAccurateCodingEnabled()`.

### Manual Verification
1. Open Kanban board, ensure a low-complexity plan is in PLAN REVIEWED.
2. Click "Copy Prompt" on that card.
3. Paste clipboard contents — confirm NO "Accuracy Mode" instruction is present.
4. Verify autoban dispatch (if CLI trigger is on) still includes accuracy instruction when `accurateCoding.enabled` setting is `true`.

## Open Questions
- None. The fix is scoped and all paths are accounted for.

## Agent Recommendation
**Send to Coder** — All changes are Band A (routine). Two simple edits to TypeScript files, followed by a rebuild. No new frameworks, no architectural changes.

---

## Reviewer Pass — 2026-03-23

### Findings

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| 1 | **MAJOR** | `pairProgramCard` handler in `KanbanProvider.ts` (lines 1519-1568) has a Mode 3 (`'prompt'`) code path where the coder prompt is written to clipboard at line 1556 with `accurateCodingEnabled` still gated only on the VS Code setting. The plan's balanced response incorrectly concluded this path was safe by only examining Mode 2 (terminal dispatch). In Mode 3, the coder prompt goes to clipboard — same bug class. | **FIXED** |
| 2 | NIT | Inconsistent omission style: Change 1 omits `accurateCodingEnabled` entirely; Change 2 passes explicit `false`. Both correct but asymmetric. | Deferred |
| 3 | NIT | Added comments slightly verbose for a single-line removal. | Deferred |

### Fix Applied — Change 3 (reviewer-added)

#### MODIFY `src/services/KanbanProvider.ts` — `pairProgramCard` handler

Moved `coderColumnMode` resolution **before** prompt building and gated `accurateCodingEnabled` on `coderColumnMode !== 'prompt'`:

```typescript
// Resolve effective Coder column mode BEFORE building prompt —
// accuracy mode only applies when dispatching to CLI terminal, not clipboard
const coderColumnId = 'CODER CODED';
const coderColumnMode = this._columnDragDropModes[coderColumnId] || 'cli';
const accurateCodingEnabled = coderColumnMode !== 'prompt' && vscode.workspace.getConfiguration('switchboard').get<boolean>('accurateCoding.enabled', true);
```

- In `'cli'` mode (Mode 2): coder prompt dispatched to terminal → accuracy preserved ✅
- In `'prompt'` mode (Mode 3): coder prompt goes to clipboard → accuracy stripped ✅

### Files Changed

| File | Change |
|------|--------|
| `src/services/KanbanProvider.ts` | Change 1 (plan): removed `accurateCodingEnabled` from `_generateBatchExecutionPrompt`. Change 3 (reviewer): gated `pairProgramCard` accuracy on `coderColumnMode !== 'prompt'`. |
| `src/services/TaskViewerProvider.ts` | Change 2 (plan): set `accurateCodingEnabled: false` in `_handleCopyPlanLink`. |

### Verification Results

- **`npx webpack --mode production`**: ✅ Clean build, zero errors, zero warnings.
- **Grep `KanbanProvider.ts` for `accurateCodingEnabled`**: Only appears in `_dispatchWithPairProgrammingIfNeeded` (terminal, correct) and `pairProgramCard` (now gated on column mode, correct). Absent from `_generateBatchExecutionPrompt` (correct).
- **Grep `TaskViewerProvider.ts` for `accurateCodingEnabled` in `_handleCopyPlanLink`**: Shows `false` (correct).

### Remaining Risks

- **None material.** All clipboard-bound prompt paths now exclude accuracy instructions. All terminal dispatch paths retain them. The gating logic in `pairProgramCard` correctly short-circuits on `coderColumnMode !== 'prompt'` before reading the VS Code setting, avoiding unnecessary config reads in Mode 3.
