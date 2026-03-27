# Tooltips are still broken

## Goal
Fix the custom tooltip system for the Kanban board and ensure that all card-level buttons (specifically 'Copy', 'Pair', 'Review', and 'Complete') have functioning, accurate tooltips. The system uses a body-level fixed overlay (`#tooltip-overlay`) to escape stacking contexts.

## Metadata
**Tags:** UI, frontend, bugfix
**Complexity:** Low

## User Review Required
> [!NOTE]
> This plan assumes that the existing `#tooltip-overlay` system is technically sound but under-utilised on card-level elements. It adds missing attributes, removes a stale CSS comment, and ensures visual consistency. No breaking changes.

## Complexity Audit
### Routine
- Adding `data-tooltip="Pair programming (Lead + Coder)"` to the `pair-program-btn` in `createCardHtml()` in `src/webview/kanban.html` (line 1446).
- Verifying the `copy` button already has `data-tooltip="Copy prompt and advance"` (line 1442 — already present, no change needed).
- Verifying the `review` button already has `data-tooltip="Review plan"` (line 1463 — already present, no change needed).
- Verifying the `complete` button already has `data-tooltip="Complete and archive"` (line 1450 — already present, no change needed).
- Removing the stale CSS comment `/* Tooltips are ONLY for column header icons/buttons, never for card elements */` on line 770 of `src/webview/kanban.html`.
### Complex / Risky
- **Sync flicker**: `renderBoard()` calls `hideTooltip()` (line 1323). If the board re-renders while the user is hovering over a card button, the tooltip will vanish mid-read. The current implementation already handles this by signature-diffing (`buildBoardSignature`) at line 1754 to suppress redundant re-renders, so the risk is acceptably low.

## Edge-Case & Dependency Audit
- **Race Conditions:** Hovering during a board refresh: `renderBoard()` calls `hideTooltip()` unconditionally (line 1323). The `buildBoardSignature` dedupe at line 1754 prevents unnecessary re-renders, limiting this to real data changes only.
- **Security:** Tooltip text is rendered via `tooltipOverlay.textContent` (line 851), preventing XSS from malicious plan topics.
- **Side Effects:** None. The tooltip delegation system at lines 888–903 uses `document.addEventListener('mouseover', ...)` with `e.target.closest('[data-tooltip]')`, so it automatically picks up any new `data-tooltip` attributes on dynamically rendered DOM without any additional wiring.
- **Dependencies & Conflicts:** Plan 2 ("Re-plan button") also modifies `src/webview/kanban.html` in the column button area (lines 1108–1111). These changes are in different regions of the file and do not conflict — Plan 1 modifies `createCardHtml()` (line 1446) and a CSS comment (line 770), while Plan 2 modifies the column header button generation (line 1108).

## Adversarial Synthesis
### Grumpy Critique
"You think adding a single `data-tooltip` attribute is a 'fix'? The *reason* the Pair button didn't have a tooltip is because someone deliberately left that CSS comment on line 770 saying 'never for card elements'. And your plan conveniently ignores it. If you delete the comment but don't audit whether something else was suppressing card-level tooltips via CSS, you'll ship a plan that *claims* to work but subtly doesn't. Also — what happens when the Copy button transitions to 'Copied!' state? The tooltip says 'Copy prompt and advance' but the button now says 'Copied!'. Stale tooltip text. And the `recover` button on completed cards at line 1432 has `data-tooltip="Recover this plan"` — did you check that? Is that still correct?"

### Balanced Response
The tooltip delegation system (`mouseover`/`mouseout` at lines 888–903) targets any `[data-tooltip]` element via `closest()` — there is zero CSS or JS suppression of card-level tooltips. The only issue was the missing `data-tooltip` attribute on the `pair-program-btn`. The CSS comment on line 770 was simply a stale policy note that no longer reflects reality. The Copy button's 'Copied!' flash (lines 1792–1808) replaces the button text via `btn.textContent` but does *not* modify `data-tooltip`, so the tooltip will correctly continue to show 'Copy prompt and advance' even during the flash — this is actually desirable since the tooltip describes the *action*, not the *state*. The `recover` button tooltip was verified and is correct.

## Proposed Changes

> [!IMPORTANT]
> **MAXIMUM DETAIL REQUIRED:** Complete code blocks with exact search/replace targeting.

### [Webview] Fix Card Tooltips
#### [MODIFY] `src/webview/kanban.html`

**Change 1: Remove stale CSS comment (line 770)**

- **Context:** Line 770 contains a stale policy comment that incorrectly states tooltips should never be used for card elements. This contradicts the current implementation where multiple card buttons already have `data-tooltip` attributes.
- **Logic:** Remove the entire comment line. The tooltip overlay system at lines 841–903 uses delegation via `e.target.closest('[data-tooltip]')` which works on any element in the DOM tree — card-level or otherwise.
- **Implementation:**

```diff
        /* Custom instant tooltips — replaces native title delay */
-        /* Tooltips are ONLY for column header icons/buttons, never for card elements */
        [data-tooltip] {
```

- **Edge Cases Handled:** None — this is a dead comment removal with no behavioural impact.

---

**Change 2: Add `data-tooltip` to `pair-program-btn` (line 1446)**

- **Context:** The Pair button is rendered inside `createCardHtml()` for high-complexity cards in the PLAN REVIEWED column. It currently lacks a `data-tooltip` attribute, making it the only actionable card button without a tooltip.
- **Logic:** Add `data-tooltip="Pair programming (Lead + Coder)"` to the button element. The existing tooltip delegation at lines 888–894 will automatically detect and display this on hover.
- **Implementation:**

```diff
            const pairProgramBtn = (card.column === 'PLAN REVIEWED' && complexity === 'High')
-                ? `<button class="card-btn pair-program-btn" data-session="${card.sessionId}">Pair</button>`
+                ? `<button class="card-btn pair-program-btn" data-session="${card.sessionId}" data-tooltip="Pair programming (Lead + Coder)">Pair</button>`
                : '';
```

- **Edge Cases Handled:** The button only renders when `card.column === 'PLAN REVIEWED' && complexity === 'High'`, so the tooltip will never appear on cards where the Pair button is hidden.

## Verification Plan
### Manual Verification
1. Open the Kanban board with at least one High-complexity card in the 'Planned' (PLAN REVIEWED) column.
2. Hover over the **Pair** button. Verify the tooltip "Pair programming (Lead + Coder)" appears above the button via the `#tooltip-overlay`.
3. Hover over the **Copy coder prompt** button. Verify "Copy prompt and advance" tooltip appears.
4. Click the **Copy** button; verify the 'Copied!' flash appears and the tooltip still shows "Copy prompt and advance" if you re-hover during the flash.
5. Hover over the **edit** (review) icon button. Verify "Review plan" tooltip appears.
6. Hover over the **checkmark** (complete) icon button. Verify "Complete and archive" tooltip appears.
7. Inspect the CSS source in DevTools and confirm the line `/* Tooltips are ONLY for column header icons/buttons, never for card elements */` no longer exists.

### Agent Recommendation
**Send to Coder** — this is a routine two-line change (one attribute addition, one comment deletion) with no complex logic.
