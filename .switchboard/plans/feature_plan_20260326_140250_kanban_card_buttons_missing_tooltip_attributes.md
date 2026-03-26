# Kanban Card Buttons Missing Tooltip Attributes

## Goal
Kanban board tooltips do not appear on card-level action buttons (Recover, Copy Prompt, Complete, Review). These tooltips are critical for user discovery of features — especially for new users who cannot infer button behavior from small icons alone. The root cause is that the `createCardHtml()` function in `src/webview/kanban.html` renders card buttons without `data-tooltip` attributes, so the existing body-level tooltip overlay system (which works correctly via event delegation on `[data-tooltip]`) never fires for them. The fix is strictly additive: add `data-tooltip` attributes to the four card buttons. No CSS, JS, or structural HTML changes are required.

**User directive:** "Do not break the rendering like the last time this was touched." The fix must be minimal — attribute additions only, no structural changes.

## User Review Required
- Confirm the four proposed tooltip strings are correct and match the product voice.
- Confirm the Pair Programming button (line 1446) should remain without a tooltip, or if a tooltip should be added for it as well.
- Confirm the stale CSS comment at line 770 (`/* Tooltips are ONLY for column header icons/buttons, never for card elements */`) should be updated or left as-is.

## Complexity Audit

**Manual Complexity Override:** Low


### Routine
- **Adding `data-tooltip` attributes to existing HTML elements** — This is a purely additive change to four string template literals inside `createCardHtml()` (lines 1421–1471 of `src/webview/kanban.html`). Each button already renders correctly; we are only inserting a new attribute into the opening `<button>` tag. No new elements, no new event listeners, no new CSS rules. The tooltip overlay system at lines 841–903 already handles display, positioning, and cleanup via event delegation on `[data-tooltip]`. The CSS at lines 769–800 already styles the overlay with `position: fixed; z-index: 9999` which escapes all card stacking contexts (`z-index: 50` on hover). Zero risk of breaking existing rendering.

### Complex / Risky
- None.


## Edge-Case & Dependency Audit

1. **Pair Programming button (line 1446):** The `<button class="card-btn pair-program-btn">` is conditionally rendered for High-complexity cards in the PLAN REVIEWED column. It also lacks a `data-tooltip` attribute. The user's bug report does not list it among the broken elements, so it is excluded from this fix. If a tooltip is desired, it can be added in a follow-up (e.g., `data-tooltip="Start pair programming session"`).

2. **Stale CSS comment (line 770):** The comment reads `/* Tooltips are ONLY for column header icons/buttons, never for card elements */`. After this fix, card elements will also have tooltips. This comment becomes misleading. However, updating the comment is a cosmetic change outside the user's directive of "add attributes only, no structural changes." Flagged for user review.

3. **Dynamic copy button label:** The Copy button label changes based on column (`Copy planning prompt`, `Copy coder prompt`, `Copy review prompt`). The tooltip text `"Copy prompt and advance"` is intentionally generic to avoid duplicating the column-specific logic in the tooltip. The visible button label already conveys the specific action.

4. **Completed cards:** When `card.column === 'COMPLETED'`, the Recover button replaces the Copy button, and the Complete button is replaced by a `<span class="card-done-badge">✓ Done</span>` (not a button). The `✓ Done` span does not need a tooltip because it is self-explanatory static text, not an interactive element.

5. **Tooltip on SVG child elements:** The Review and Complete buttons contain inline `<svg>` elements. The `mouseover` event delegation at line 890 uses `e.target.closest('[data-tooltip]')`, which correctly bubbles from `<svg>` or `<path>` up to the parent `<button>` element. No issue.

6. **Attribute injection via `card.sessionId` or `card.workspaceRoot`:** These values are already used in `data-session` and `data-workspace-root` attributes on the same buttons (with `escapeAttr()` for `workspaceRoot`). The new `data-tooltip` attributes use hardcoded string literals, so there is zero injection risk.

7. **Cross-plan conflicts:** None. This change is self-contained within `createCardHtml()` and does not touch the tooltip overlay system, CSS, or any other function.

## Adversarial Synthesis

### Grumpy Critique
Oh, *wonderful*. Four buttons shipped to production without tooltips. Four. The tooltip system was sitting RIGHT THERE — a perfectly functional event-delegation overlay that's been working for every column header button since day one — and nobody thought to slap `data-tooltip` on the card buttons? There's even a CSS comment on line 770 that says "Tooltips are ONLY for column header icons/buttons, never for card elements" — so someone *intentionally* excluded card elements and then everyone forgot that was a terrible idea.

And now we're told "do not break the rendering like the last time this was touched." Which means someone already broke this area once before. Confidence-inspiring. The fix is four attribute additions. FOUR. If this plan somehow manages to introduce a regression, I am personally revoking everyone's commit access.

Also — the Pair Programming button? Still no tooltip. Nobody noticed? It's a conditionally rendered button with no label, just the text "Pair." Pair *what*? Pair of socks? I suppose we'll need a follow-up plan for that too. Can't wait.

The proposed tooltip text `"Copy prompt and advance"` for the Copy button is acceptable but bland. The button label already says "Copy planning prompt" or "Copy coder prompt" — the tooltip should arguably match. But fine, generic is safer than wrong, and I've seen what happens when people try to get clever with dynamic tooltip text in template literals.

Ship it. But if anyone touches the `createCardHtml` function for anything other than adding these four attributes, I will find out.

### Balanced Response
The Grumpy critique is theatrically delivered but substantively correct on all points:

1. **The fix is trivially safe.** Four hardcoded `data-tooltip` attributes on existing `<button>` elements, consumed by an already-working event delegation system. Risk of regression is near zero.

2. **The Pair Programming button gap is real** but out of scope for this plan. It should be tracked as a separate follow-up item. The user's report specifically identified four buttons; adding a fifth without review would violate the "no net-new product requirements" directive.

3. **The stale CSS comment on line 770 is worth flagging** but not worth fixing in this plan. It's a comment, not code. Changing it in the same PR is fine cosmetically but mixed-concern commits have historically caused confusion in this codebase. Flag it, move on.

4. **The generic tooltip text for the Copy button is the right call.** Matching the dynamic label would require duplicating the column-switch logic (`CREATED` → "Copy planning prompt", `PLAN REVIEWED` → "Copy coder prompt", etc.) in the tooltip attribute. That's fragile and unnecessary — the button's visible label already provides the specific context. The tooltip's job is to explain *what happens*, not to repeat the label.

5. **The "do not break rendering" directive is satisfied** by the minimal, attribute-only approach. No DOM structure changes, no new elements, no CSS modifications, no JavaScript changes.

## Proposed Changes

### Card Button Tooltips in `createCardHtml()`

#### [MODIFY] `src/webview/kanban.html`
- **Context:** The `createCardHtml()` function (lines 1421–1471) generates the HTML for each Kanban card. Four interactive buttons are rendered without `data-tooltip` attributes, preventing the existing tooltip overlay system from displaying help text on hover.
- **Logic:** Add a `data-tooltip="..."` attribute to each of the four card buttons. The tooltip overlay system (lines 841–903) uses event delegation on `[data-tooltip]` via `document.addEventListener('mouseover', ...)` and `e.target.closest('[data-tooltip]')`. Adding the attribute is the only change needed to activate tooltips for these elements.
- **Implementation:**
  1. **Recover button (line 1432):** Change the opening tag from:
     ```html
     <button class="card-btn recover" data-session="${card.sessionId}">
     ```
     to:
     ```html
     <button class="card-btn recover" data-session="${card.sessionId}" data-tooltip="Recover this plan">
     ```
  2. **Copy button (line 1442):** Change the opening tag from:
     ```html
     <button class="card-btn copy" data-session="${card.sessionId}" data-workspace-root="${escapeAttr(card.workspaceRoot)}">
     ```
     to:
     ```html
     <button class="card-btn copy" data-session="${card.sessionId}" data-workspace-root="${escapeAttr(card.workspaceRoot)}" data-tooltip="Copy prompt and advance">
     ```
  3. **Complete button (line 1450):** Change the opening tag from:
     ```html
     <button class="card-btn icon-btn complete" data-session="${card.sessionId}" data-workspace-root="${escapeAttr(card.workspaceRoot)}">
     ```
     to:
     ```html
     <button class="card-btn icon-btn complete" data-session="${card.sessionId}" data-workspace-root="${escapeAttr(card.workspaceRoot)}" data-tooltip="Complete and archive">
     ```
  4. **Review button (line 1463):** Change the opening tag from:
     ```html
     <button class="card-btn icon-btn review" data-session="${card.sessionId}" data-workspace-root="${escapeAttr(card.workspaceRoot)}">
     ```
     to:
     ```html
     <button class="card-btn icon-btn review" data-session="${card.sessionId}" data-workspace-root="${escapeAttr(card.workspaceRoot)}" data-tooltip="Review plan">
     ```
- **Edge Cases Handled:**
  - Recover button only renders for `COMPLETED` cards; Copy button only renders for non-completed cards. Both paths are covered independently.
  - Complete button is replaced by a static `✓ Done` badge on completed cards. The badge is a `<span>`, not a button, and does not need a tooltip.
  - SVG children inside the Complete and Review buttons will correctly bubble `mouseover` events to the parent `<button>` via `e.target.closest('[data-tooltip]')`.
  - All tooltip strings are hardcoded literals — no injection risk from card data.

## Verification Plan

### Automated Tests
- Run `npm run compile` (or the project's existing build command) to verify the HTML template change does not introduce syntax errors or break the webpack build.
- If the project has existing webview tests or snapshot tests, run them to confirm no regressions.

### Manual Tests
1. Open the Kanban board webview in VS Code.
2. **Hover over the Copy Prompt button** on any card in the CREATED, PLAN REVIEWED, or LEAD CODED / CODER CODED columns. Verify the tooltip `"Copy prompt and advance"` appears above the button within ~100ms.
3. **Hover over the Review button** (pencil icon) on any card. Verify the tooltip `"Review plan"` appears.
4. **Hover over the Complete button** (checkmark icon) on any non-completed card. Verify the tooltip `"Complete and archive"` appears.
5. **Move a card to the COMPLETED column.** Hover over the **Recover button**. Verify the tooltip `"Recover this plan"` appears.
6. **Verify no tooltip appears on the `✓ Done` badge** on completed cards (expected — it's a `<span>`, not a `<button>`).
7. **Verify existing tooltips still work:** hover over the workspace selector, autoban button, CLI toggle, pair programming toggle, sync button, and all column header buttons. All should display their tooltips as before.
8. **Test tooltip positioning near edges:** drag the VS Code panel so a card button is near the right edge of the viewport. Hover over it and verify the tooltip is clamped within the viewport (handled by the existing JS at lines 870–874).
9. **Verify no rendering regressions:** cards should display identically to before — same layout, same button sizes, same spacing. The only visible change is the new tooltips on hover.

## Recommendation
**Send to Coder.** This is a minimal, low-risk, single-file change — four attribute additions to existing HTML template strings. No architectural decisions, no cross-file dependencies, no complex logic. A standard coder can execute this in under 5 minutes with full confidence.

## Reviewer Pass

### Stage 1 — Grumpy Principal Engineer Review

Well, well, well. Someone actually followed instructions for once. Four buttons, four `data-tooltip` attributes, zero structural changes. Let me see if I can find something to complain about.

**Recover button (line 1432):** `data-tooltip="Recover this plan"` — ✅ Matches plan spec exactly. Attribute placed after `data-session`, consistent with existing patterns. PASS.

**Copy button (line 1442):** `data-tooltip="Copy prompt and advance"` — ✅ Matches plan spec. Attribute appended after `data-workspace-root`. PASS.

**Complete button (line 1450):** `data-tooltip="Complete and archive"` — ✅ Matches plan spec. Attribute appended after `data-workspace-root`. PASS.

**Review button (line 1463):** `data-tooltip="Review plan"` — ✅ Matches plan spec. Attribute appended after `data-workspace-root`. PASS.

**Pair Programming button (line 1446):** No `data-tooltip` attribute. Correct — explicitly out of scope per plan. PASS.

**CSS changes:** None. PASS.
**JS changes:** None. PASS.
**Structural HTML changes:** None. PASS.

| # | Finding | Severity | Description |
|---|---------|----------|-------------|
| 1 | Stale CSS comment | NIT | Line 770: `/* Tooltips are ONLY for column header icons/buttons, never for card elements */` is now factually wrong. Card buttons now have tooltips. Comment is misleading but harmless — it's a comment, not code. |
| 2 | Pair Programming button gap | NIT | Line 1446: The Pair Programming button still lacks a tooltip. Explicitly out of scope per plan, but remains a UX gap for discoverability. |

**No CRITICAL or MAJOR findings.** The implementation is a clean, exact match to the plan specification.

### Stage 2 — Balanced Synthesis

| # | Finding | Verdict | Rationale |
|---|---------|---------|-----------|
| 1 | Stale CSS comment (NIT) | **Defer** | The comment is misleading but not harmful. Fixing it in this change would violate the user directive of "attribute additions only, no structural changes." Track as a follow-up. |
| 2 | Pair Programming button (NIT) | **Defer** | Explicitly excluded from scope in the plan and edge-case audit. Should be tracked as a separate follow-up item with user review of desired tooltip text. |

**No code fixes required.** Zero CRITICAL or MAJOR findings to act on.

### Stage 3 — Code Fixes

No fixes applied. All findings were NITs deferred to follow-up work.

### Stage 4 — Verification

- **Command:** `npm run compile`
- **Result:** ✅ Both webpack bundles compiled successfully with exit code 0.
  - `extension.js` — compiled successfully
  - `mcp-server.js` — compiled successfully
- **No errors, no warnings related to this change.**

### Stage 5 — Summary

**Files reviewed:** `src/webview/kanban.html` (lines 1421–1471, `createCardHtml()`)

**Implementation status:** ✅ COMPLETE — all four `data-tooltip` attributes are present with correct values, matching the plan specification exactly.

**Remaining risks:**
1. Manual verification pending: tooltip positioning and visual rendering in the VS Code webview cannot be tested from CLI. Recommend manual hover-test per the plan's verification checklist (items 2–9).
2. Stale CSS comment on line 770 should be cleaned up in a follow-up.
3. Pair Programming button tooltip should be addressed in a separate plan with user input on desired text.

**Verdict:** APPROVED — ship it.
