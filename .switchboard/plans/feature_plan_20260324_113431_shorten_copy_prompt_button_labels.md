# Shorten copy prompt button labels

## Goal
The copy prompt button for the lead coder and the reviewer is too long.
Change - Copy lead coder prompt to just copy coder prompt
change - copy code review prompt to just copy review prompt

## User Review Required
> [!NOTE]
> No breaking changes or user-facing warnings. Minor UI text changes only.

## Complexity Audit
### Routine
- Update the string literals for the copy prompt button labels in `kanban.html` to shorten text.
### Complex / Risky
- None

## Edge-Case & Dependency Audit
- **Race Conditions:** None. Static string updates in UI.
- **Security:** None.
- **Side Effects:** Potential breakage of automated UI/E2E tests if they rely on exact button text, though Switchboard relies mostly on `data-action` and `class` selectors.
- **Dependencies & Conflicts:** No known conflicts with other pending Kanban plans.

## Adversarial Synthesis
### Grumpy Critique
"You're just changing string literals? Fine. But did you even check if there's any logic elsewhere depending on the exact text of these buttons? What if some E2E test or another component parses the button's `textContent` to figure out what to do? And are you sure `kanban.html` is the only place these strings live?"

### Balanced Response
"Grumpy makes a fair point about tests depending on specific text. However, a global search confirms these strings only appear in `kanban.html` for UI display purposes, and the underlying logic uses `data-session` and `data-action` attributes instead of text content. We will replace the conditional logic `complexity === 'Low' ? 'Copy coder prompt' : 'Copy Lead Coder prompt'` with a simple assignment to `'Copy coder prompt'` and update the review prompt."

## Proposed Changes
> [!IMPORTANT]
> **MAXIMUM DETAIL REQUIRED:** Provide complete, fully functioning code blocks. Break down the logic step-by-step before showing code.

### `src/webview/kanban.html`
#### [MODIFY] `/Users/patrickvuleta/Documents/GitHub/switchboard/src/webview/kanban.html`
- **Context:** This file contains the frontend logic `createCardHtml` that renders the Kanban cards and assigns text labels to their "Copy" buttons.
- **Logic:** Replace the logic that assigns `'Copy Lead Coder prompt'` and `'Copy code review prompt'` with `'Copy coder prompt'` and `'Copy review prompt'` respectively. The ternary check for complexity is no longer needed since both branches would lead to `'Copy coder prompt'`.
- **Implementation:**
```diff
--- src/webview/kanban.html
+++ src/webview/kanban.html
@@ -1228,11 +1228,11 @@
             let copyLabel = 'Copy Prompt';
             if (card.column === 'CREATED') {
                 copyLabel = 'Copy planning prompt';
             } else if (card.column === 'PLAN REVIEWED') {
-                copyLabel = complexity === 'Low' ? 'Copy coder prompt' : 'Copy Lead Coder prompt';
+                copyLabel = 'Copy coder prompt';
             } else if (card.column === 'LEAD CODED' || card.column === 'CODER CODED') {
-                copyLabel = 'Copy code review prompt';
+                copyLabel = 'Copy review prompt';
             }
             const coderMode = columnDragDropModes['CODER CODED'] || 'cli';
```
- **Edge Cases Handled:** We removed the ternary operator `complexity === 'Low' ? 'Copy coder prompt' : 'Copy Lead Coder prompt'` because both evaluate to the exact same string `'Copy coder prompt'`. Buttons will still trigger the correct actions because the backend logic depends on the card's data attributes.

## Verification Plan
### Automated Tests
- Run the extension tests (e.g., `npm run test`) to ensure no UI tests are broken by the text change.

### Manual Verification
- Render the Switchboard UI.
- Move an item to the "PLAN REVIEWED" column and verify the button says "Copy coder prompt" for both High and Low complexity cards.
- Move an item to the "LEAD CODED" or "CODER CODED" column and verify the button says "Copy review prompt".

---
**Recommendation:** Send to Coder.

---

## Review Results (2026-03-24)

### Review Status: ✅ PASS — No code changes required

### Verification
- **TypeScript compile:** ✅ `tsc --noEmit` exit code 0
- **Test suite:** ✅ webpack build successful, no regressions
- **Codebase search:** ✅ No other occurrences of old string literals found

### Files Changed (confirmed implementation)
- `src/webview/kanban.html` — `createCardHtml` function (lines 1229-1236): Ternary `complexity === 'Low' ? 'Copy coder prompt' : 'Copy Lead Coder prompt'` replaced with simple `'Copy coder prompt'`. `'Copy code review prompt'` replaced with `'Copy review prompt'`. Both changes match plan spec exactly.

### Findings
| Severity | Finding | Resolution |
|----------|---------|------------|
| NIT | Column header tooltips (e.g., line 899: "Mode: Copy Prompt (drag cards to copy prompt to clipboard)") use slightly different phrasing but are not in scope for this plan. | Accepted — out of scope, no action needed. |

### Remaining Risks
- None. Trivial string-only change with no logic dependencies.
