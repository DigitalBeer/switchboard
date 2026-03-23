# Clarify copy prompt buttons

## Goal
The copy prompt buttons on the kanban cards are not clear. Instead, the prompt button labels should change based on the target column:

* Copy planning prompt
* Copy Lead Coder prompt
* Copy coder prompt
* Copy code review prompt

This will help guide a user of an IDE to the correct model choice per task.

## User Review Required
> [!NOTE]
> The copy button label on each kanban card will change from the static "Copy Prompt" to a column-aware and complexity-aware label. No clipboard content changes — the backend already generates the correct prompt text per column. This is a purely cosmetic/UX label change in the webview.

## Complexity Audit
### Band A — Routine
- **Label mapping logic**: Add a column-to-label mapping in the `createCardHtml` function in `src/webview/kanban.html`. The `card.column` and `card.complexity` properties are already available in that scope (used at lines 1234 and 1227 respectively).
- **Button tooltip update**: Update the `title` attribute on the copy button to match the new dynamic label for consistency.
- **Rebuild**: Recompile via `npm run compile` so `dist/webview/kanban.html` matches the source.

### Band B — Complex / Risky
- None.

## Edge-Case & Dependency Audit
- **Race Conditions:** None. `card.column` and `card.complexity` are read synchronously during HTML string generation. No async or shared-state concerns.
- **Security:** No new attack vectors. Labels are hardcoded string literals keyed off existing column/complexity values. No user-supplied input is injected into labels.
- **Side Effects:**
  - The "Copied!" flash feedback in the `copyPlanLinkResult` handler (`kanban.html` lines 1481–1501) saves `btn.textContent` as `originalText` and restores it after 1500ms. Dynamic labels are preserved correctly because `originalText` captures the current label at click time.
  - The sidebar "Copy" button in the TaskViewerProvider is a completely separate code path and is not affected.
  - Custom agent columns (`custom_agent_*`) will fall through to the default "Copy Prompt" label, which is correct since there's no predefined role label for custom agents.
- **Dependencies & Conflicts:**
  - **`feature_plan_20260311_225207_improve_kanban_copy_button.md`** (COMPLETED): Previously implemented similar column-aware labels with different wording ("Copy execution prompt", "Copy review prompt", "Copy plan link"). That plan's labels have regressed — current code shows the generic `let copyLabel = 'Copy Prompt'` at `kanban.html` line 1229. This plan supersedes that older plan's label choices with the user's updated preferred wording.
  - **`feature_plan_20260323_205754_remove_accuracy_workflow_from_copy_prompts.md`**: Touches copy prompt backend paths (accuracy flag) but not button labels. No conflict.
  - No other active plans modify `createCardHtml` or the copy button label.

## Adversarial Synthesis

### Grumpy Critique
**MAJOR — PLAN REVIEWED has TWO possible labels, but you're keying off `card.complexity` which can be `'Unknown'`.** What happens when complexity hasn't been determined yet? Your shiny "Copy Lead Coder prompt" / "Copy coder prompt" split falls apart. Complexity comes from `KanbanProvider.getComplexityFromPlan` which parses the Band B section of the plan markdown. If the plan doesn't HAVE a complexity audit — and plenty of freshly-created plans won't — you get `'Unknown'`. Then the backend falls back to `'lead'` role anyway (`TaskViewerProvider.ts` line 5761: `complexity === 'Low' ? 'coder' : 'lead'`). So the label MUST fall back to "Copy Lead Coder prompt" for Unknown, or the label and actual clipboard content will be mismatched. Show me you've handled this.

**MAJOR — You said "single file change" but the previous plan's identical label changes were undone.** The `feature_plan_20260311_225207_improve_kanban_copy_button.md` reviewer pass explicitly confirmed labels were updated, yet current code shows `let copyLabel = 'Copy Prompt'`. That means something downstream — a merge conflict, a webpack copy step, a manual revert — clobbered the labels. How confident are you that the same thing won't happen to YOUR changes? The verification plan MUST include checking `dist/webview/kanban.html` after build.

**NIT — The button tooltip still says "Copy prompt to clipboard" regardless of column.** If you're fixing labels, fix the tooltip too or it's half-baked.

### Balanced Response
Both MAJOR points are valid and addressed:

1. **Unknown complexity fallback**: When `card.complexity` is `'Unknown'` or anything other than `'Low'`, the label defaults to "Copy Lead Coder prompt" for PLAN REVIEWED. This matches the backend's behavior where `complexity === 'Low' ? 'coder' : 'lead'` — anything non-Low (including Unknown) dispatches to lead. Label and clipboard content stay aligned.

2. **Build pipeline regression**: The verification plan now mandates a post-build diff check on `dist/webview/kanban.html` to confirm labels survived compilation. The project uses webpack `CopyWebpackPlugin` to copy the webview HTML to dist.

3. **Tooltip (NIT)**: Addressed — the `title` attribute is updated to use the dynamic `copyLabel` value via `escapeAttr()` so hover text matches the button label.

## Proposed Changes

> [!IMPORTANT]
> **MAXIMUM DETAIL REQUIRED:** Provide complete, fully functioning code blocks. Break down the logic step-by-step before showing code.

### 1. Kanban Webview — Dynamic Copy Button Labels

#### [MODIFY] `src/webview/kanban.html`
- **Context:** The `createCardHtml` function (line 1224) builds the HTML for each kanban card. The copy button label is currently hardcoded to `'Copy Prompt'` on line 1229. Both `card.column` (line 1234) and `card.complexity` (line 1227) are already available in scope.
- **Logic:**
  1. Replace the hardcoded `let copyLabel = 'Copy Prompt'` with an if-else block that maps `card.column` to the correct label:
     - `CREATED` → `'Copy planning prompt'`
     - `PLAN REVIEWED` → check `card.complexity`: if `'Low'` → `'Copy coder prompt'`, otherwise (High/Unknown) → `'Copy Lead Coder prompt'`
     - `LEAD CODED` or `CODER CODED` → `'Copy code review prompt'`
     - All other columns (CODE REVIEWED, custom agents, fallback) → `'Copy Prompt'`
  2. Update the button's `title` attribute to use the dynamic `copyLabel` instead of the static "Copy prompt to clipboard".
- **Implementation:**

Find (line 1229):
```javascript
            let copyLabel = 'Copy Prompt';
```

Replace with:
```javascript
            let copyLabel = 'Copy Prompt';
            if (card.column === 'CREATED') {
                copyLabel = 'Copy planning prompt';
            } else if (card.column === 'PLAN REVIEWED') {
                copyLabel = complexity === 'Low' ? 'Copy coder prompt' : 'Copy Lead Coder prompt';
            } else if (card.column === 'LEAD CODED' || card.column === 'CODER CODED') {
                copyLabel = 'Copy code review prompt';
            }
```

Find (line 1244):
```html
                            <button class="card-btn copy" data-session="${card.sessionId}" data-workspace-root="${escapeAttr(card.workspaceRoot)}" title="Copy prompt to clipboard">${copyLabel}</button>
```

Replace with:
```html
                            <button class="card-btn copy" data-session="${card.sessionId}" data-workspace-root="${escapeAttr(card.workspaceRoot)}" title="${escapeAttr(copyLabel)}">${copyLabel}</button>
```

- **Edge Cases Handled:**
  - `card.complexity === 'Unknown'` falls through the `!== 'Low'` check to "Copy Lead Coder prompt", matching the backend's lead-role fallback at `TaskViewerProvider.ts` line 5761.
  - Custom agent columns (`custom_agent_*`) fall through to the default "Copy Prompt" — correct, as there's no predefined role label.
  - CODE REVIEWED cards get the generic "Copy Prompt" label since there's no canonical next-step agent.
  - The "Copied!" flash restore in the `copyPlanLinkResult` handler preserves the dynamic label via `originalText = btn.textContent`.

## Verification Plan
### Automated Tests
- Run `npm run compile` — confirm clean build with no errors.
- Inspect `dist/webview/kanban.html` after build — confirm the `copyLabel` if-else logic matches the source file exactly.

### Manual Testing
1. Open Kanban board with plans in various columns.
2. **CREATED column**: Verify button shows "Copy planning prompt". Hover: tooltip matches.
3. **PLAN REVIEWED column (High complexity)**: Verify button shows "Copy Lead Coder prompt".
4. **PLAN REVIEWED column (Low complexity)**: Verify button shows "Copy coder prompt".
5. **PLAN REVIEWED column (Unknown complexity)**: Verify button shows "Copy Lead Coder prompt" (fallback).
6. **LEAD CODED or CODER CODED column**: Verify button shows "Copy code review prompt".
7. **CODE REVIEWED column**: Verify button shows generic "Copy Prompt".
8. Click any copy button → verify "Copied!" flash appears, then original dynamic label is restored after 1500ms.

## Open Questions
- None. All label mappings are explicitly defined by the user's requirements, and the backend prompt generation already matches these role assignments.

## Agent Recommendation
**Send to Coder** — All changes are Band A (routine). Single file edit to `src/webview/kanban.html` with a straightforward column-to-label mapping. No new frameworks, no architectural changes, no backend modifications needed.

---

## Reviewer Pass — 2026-03-23

### Files Changed
| File | Change |
|---|---|
| `src/webview/kanban.html` | Lines 1229–1236: column-aware `copyLabel` if-else block added. Line 1251: dynamic `title="${escapeAttr(copyLabel)}"` on copy button. |
| `dist/webview/kanban.html` | Rebuilt via `npm run compile` — identical to source. |

### Validation Results
- **`npm run compile`**: Exit code 0. Webpack compiled successfully (both extension and MCP server bundles).
- **Source/dist parity**: `dist/webview/kanban.html` lines 1224–1263 are byte-identical to `src/webview/kanban.html`.
- **Regression test**: `kanban-view-plan-removal-regression.test.js` assertion at line 35 checks for `'${copyLabel}'` template variable — unaffected by dynamic label change.

### Review Findings
| Severity | Finding | Status |
|---|---|---|
| NIT | `escapeAttr()` only escapes double quotes — safe here (hardcoded labels), but fragile if user input ever reaches labels. | Deferred — pre-existing, out of scope. |
| NIT | No inline comment explaining `custom_agent_*` fallthrough to default `'Copy Prompt'` label. | Deferred — documentation preference, no functional impact. |
| VERIFIED | Unknown complexity fallback correctly maps to "Copy Lead Coder prompt" (matches backend `complexity === 'Low' ? 'coder' : 'lead'`). | No issue. |
| VERIFIED | "Copied!" flash handler preserves dynamic label via `originalText = btn.textContent` snapshot. | No issue. |
| VERIFIED | Source and dist files are in sync after build. | No issue. |

### Remaining Risks
- **Low**: If a future change introduces user-supplied or dynamic label text, `escapeAttr()` must be hardened to escape `&`, `<`, `>`, and `'` in addition to `"`.
- **None** for current implementation scope.

### Reviewer Verdict
**PASS** — Implementation matches plan spec exactly. Zero CRITICAL or MAJOR findings. No code fixes required.
