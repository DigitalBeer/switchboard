# Fix Multi-Select Drag and Drop on Kanban Board

## Goal
When multiple kanban cards are selected (via click-to-toggle), dragging any one of them should move **all** selected cards in the same column to the drop target — matching the behaviour of the existing button-based bulk actions (moveSelected, promptSelected, etc.). Currently, only the single physically-dragged card is moved; the rest of the selection is silently ignored.

## User Review Required
- Confirm that the expected behaviour is: dragging a selected card moves all selected cards **in the same source column** (not across columns). Cards selected in other columns remain selected but are not moved.
- Confirm that selection should be cleared after a successful multi-card drop (consistent with button actions).

## Complexity Audit

**Manual Complexity Override:** Low


### Routine
- **`handleDragStart` data transfer fix** — The drop handler (`handleDrop`, lines 1549–1713) already parses `application/json` for an array of session IDs and iterates over them for optimistic DOM moves, count updates, forward/backward routing, completion handling, and batch dispatch. The only missing piece is setting that `application/json` payload in `handleDragStart`. This is a straightforward data-wiring fix.
- **Selection clearing on drop** — `handleDrop` already clears `.selected` class from all cards at line 1689 (`document.querySelectorAll('.kanban-card.selected').forEach(el => el.classList.remove('selected'))`). We just need to also clear the `selectedCards` Set to keep JS state in sync with the DOM — a one-liner.
- **`handleDragEnd` cleanup** — Currently only removes `dragging` from `e.target` (line 1523). Needs to remove it from all cards that received it during `handleDragStart`. Trivial querySelectorAll cleanup.

### Complex / Risky
- None.


## Edge-Case & Dependency Audit
1. **Single card drag (no selection)** — If `selectedCards` is empty or the dragged card is not in it, `idsToTransfer` stays as `[draggedId]`. The `application/json` payload is still set (as a single-element array), and `text/plain` fallback also works. No regression.
2. **Dragged card selected but it's the only one** — `selectedCards.size > 1` check prevents treating a single selected card as a multi-drag. Falls through to single-card behaviour.
3. **Selected cards span multiple columns** — `getSelectedInColumn(card.column)` scopes to the dragged card's column only. Cards selected in other columns are unaffected and remain selected.
4. **Drop onto same column** — `handleDrop` already short-circuits per card at line 1569: `if (!card || card.column === targetColumn) return;`. Multi-drag into the same column is a no-op, same as single drag.
5. **Rapid drag during re-render** — If `currentCards` is being rebuilt during a `handleDragStart`, `currentCards.find()` may return `undefined`. The `if (card)` guard ensures fallback to single-card drag.
6. **`application/json` parse in `handleDrop`** — Already wrapped in try/catch (lines 1555–1560). If the JSON payload is malformed for any reason, the fallback reads `text/plain` and proceeds with single-card behaviour.
7. **Visual feedback during drag** — All selected cards in the column should get the `dragging` CSS class so the user sees which cards will move. On `dragend`, all `dragging` classes are removed.
8. **Selection state after drop** — `selectedCards` Set must be cleared for the transferred IDs to stay in sync with the DOM clear at line 1689. If the drop is cancelled (dragend without drop), selection should remain intact.

## Adversarial Synthesis

### Grumpy Critique
Oh, *fantastic*. We built an entire multi-select system — click toggles, visual highlights, a dedicated `selectedCards` Set, a `getSelectedInColumn()` helper, and SEVEN different button actions that all correctly iterate over the selection — and then someone wired up drag-and-drop with `setData('text/plain', singleId)` and called it a day. The drop handler even has `JSON.parse(e.dataTransfer.getData('application/json'))` sitting there, *waiting patiently* for data that never arrives. It's like building a four-lane highway and forgetting to put an on-ramp.

And let's talk about `handleDragEnd`. It removes `dragging` from `e.target` — the ONE card the browser tracks as the drag source. So when we start adding `dragging` to all selected cards for visual feedback, we'd better not forget to clean up ALL of them on dragend. Because nothing says "polished UX" like ghost cards stuck in a translucent dragging state forever.

The `currentCards.find()` lookup concerns me. We're reaching into mutable shared state during a drag event. If a WebSocket message triggers a re-render mid-drag, `currentCards` gets rebuilt and our reference is stale. Yes, the guard handles it, but this is the kind of thing that produces a "works 99% of the time" bug report six months from now.

At least the drop handler is already multi-ID-aware. Small mercies. The actual fix is about ten lines of code in one function. But those ten lines need to be *exactly right* or we'll introduce a regression in single-card drag that affects every user, not just the multi-select power users.

### Balanced Response
The critique is valid but the risk is well-contained. Here's why this is safe:

1. **The drop side is already done.** `handleDrop` parses `application/json`, iterates over arrays of IDs, handles forward/backward routing, completion triggers, batch dispatch, and optimistic DOM updates — all for multiple IDs. This was clearly designed for multi-drag but the drag-start side was never connected. We're completing existing architecture, not inventing new plumbing.

2. **The gating logic is conservative.** We only enter multi-drag when `selectedCards.has(draggedId) && selectedCards.size > 1` AND `getSelectedInColumn()` returns more than one ID. Three separate conditions must be true. A false in any one falls back to single-card drag identically to the current behaviour.

3. **`currentCards` staleness is theoretical.** The Kanban board re-renders on `updateBoard` messages, which replace all card DOM elements. A drag-in-progress would be interrupted by the DOM replacement (browser cancels the drag), so the stale-reference scenario requires a render that *doesn't* touch the dragged card's container — unlikely given the full-board render approach. The `if (card)` guard covers it regardless.

4. **Selection clearing matches existing patterns.** Every button action in lines 1178–1234 calls `ids.forEach(id => selectedCards.delete(id))` after dispatching. The drop handler already clears the CSS class. Adding `selectedCards.clear()` at the same point is consistent.

5. **The `dragging` class cleanup is a querySelectorAll.** We replace `e.target.classList.remove('dragging')` with `document.querySelectorAll('.kanban-card.dragging').forEach(el => el.classList.remove('dragging'))`. This is safe even if called when no cards have the class.

## Proposed Changes

### Kanban Webview — Drag and Drop Multi-Select Support

#### [MODIFY] `src/webview/kanban.html`

- **Context:** `handleDragStart` (lines 1514–1520) currently sets `text/plain` with a single session ID. The drop handler already supports `application/json` arrays but never receives them.
- **Logic:** When the dragged card is part of a multi-selection (`selectedCards.has(draggedId) && selectedCards.size > 1`), collect all selected IDs in the same column via `getSelectedInColumn()` and set them as a JSON array in `application/json` dataTransfer. Always set `text/plain` as a single-ID fallback. Add `dragging` class to all transferred cards for visual feedback.
- **Implementation:**
  Replace the `handleDragStart` function (lines 1514–1520) with:
  ```javascript
  function handleDragStart(e) {
      const draggedId = e.target.dataset.session;
      draggedSessionId = draggedId;
      e.target.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';

      // Check if the dragged card is part of a multi-selection
      let idsToTransfer = [draggedId];
      if (selectedCards.has(draggedId) && selectedCards.size > 1) {
          const card = currentCards.find(c => c.sessionId === draggedId);
          if (card) {
              const selectedInColumn = getSelectedInColumn(card.column);
              if (selectedInColumn.length > 1) {
                  idsToTransfer = selectedInColumn;
              }
          }
      }

      // Add dragging class to all cards being transferred
      idsToTransfer.forEach(id => {
          const el = document.querySelector(`.kanban-card[data-session="${id}"]`);
          if (el) el.classList.add('dragging');
      });

      e.dataTransfer.setData('application/json', JSON.stringify(idsToTransfer));
      e.dataTransfer.setData('text/plain', draggedId);
      e.dataTransfer.setData('application/switchboard-workspace-root', e.target.dataset.workspaceRoot || getActiveWorkspaceRoot());
  }
  ```
- **Edge Cases Handled:**
  - Dragged card not selected → `selectedCards.has()` is false → single-card drag
  - Only one card selected → `selectedCards.size > 1` is false → single-card drag
  - `currentCards.find()` returns undefined → `if (card)` guard → single-card drag
  - `getSelectedInColumn()` returns 0 or 1 → length check → single-card drag
  - Cross-column selection → `getSelectedInColumn(card.column)` scopes to source column only

#### [MODIFY] `src/webview/kanban.html`

- **Context:** `handleDragEnd` (lines 1522–1526) only removes `dragging` from the single `e.target` element. With multi-select drag, multiple cards may have the `dragging` class.
- **Logic:** Replace single-element class removal with a querySelectorAll sweep to clean up all cards.
- **Implementation:**
  Replace the `handleDragEnd` function (lines 1522–1526) with:
  ```javascript
  function handleDragEnd(e) {
      document.querySelectorAll('.kanban-card.dragging').forEach(el => el.classList.remove('dragging'));
      document.querySelectorAll('.column-body').forEach(el => el.classList.remove('drag-over'));
      draggedSessionId = null;
  }
  ```
- **Edge Cases Handled:**
  - No cards have `dragging` class (cancelled drag) → querySelectorAll returns empty NodeList → no-op
  - Single card drag → removes class from just that one card (same as before)

#### [MODIFY] `src/webview/kanban.html`

- **Context:** `handleDrop` (line 1689) clears the `.selected` CSS class from all cards after a successful drop, but does not clear the `selectedCards` JavaScript Set. This leaves JS state out of sync with the DOM.
- **Logic:** Clear the `selectedCards` Set immediately after clearing the CSS classes. This matches the pattern used by all button actions (lines 1183, 1190, 1197, 1204, 1211, 1218, 1225, 1232).
- **Implementation:**
  After line 1689, add:
  ```javascript
  selectedCards.clear();
  ```
- **Edge Cases Handled:**
  - No cards were selected (single drag) → `selectedCards` may be empty → `.clear()` on empty Set is a no-op
  - Cards selected in other columns → all selections are cleared (consistent with button action behaviour where selection is cleared after any bulk operation)

## Verification Plan

### Automated Tests
- No existing automated test suite for the Kanban webview (it's an HTML file with inline JS rendered in a VS Code webview). Manual testing is the primary verification method.

### Manual Tests
1. **Single card drag (no selection)** — Click a card to deselect all, then drag one card to another column. Verify it moves alone. Verify no `dragging` ghost classes remain.
2. **Single card drag (card is selected but alone)** — Select one card, drag it. Verify it moves alone.
3. **Multi-select drag** — Select 3 cards in the same column. Drag one of them to another column. Verify all 3 move. Verify selection is cleared after drop. Verify all 3 get drop animation.
4. **Multi-select drag, dragged card not selected** — Select 2 cards, then drag a *different* unselected card from the same column. Verify only the dragged card moves.
5. **Cross-column selection** — Select cards in Column A and Column B. Drag a selected card from Column A. Verify only Column A's selected cards move. Column B's selection remains.
6. **Drop onto same column** — Select cards, drag to the same column. Verify nothing changes.
7. **Drop onto COMPLETED** — Select 2 cards, drag to COMPLETED. Verify both get the completion animation and both `completePlan` messages fire.
8. **Backward drag from COMPLETED** — Select 2 completed cards, drag backward. Verify `uncompleteCard` message fires with both IDs.
9. **Cancel drag (press Escape)** — Start dragging with multi-select, press Escape. Verify `dragging` class is removed from all cards. Verify selection remains intact.
10. **Visual feedback** — During a multi-select drag, verify all selected cards in the column show the `dragging` visual state (reduced opacity / translucent).

## Recommendation
**Send to Coder** — This is a focused, single-file fix with three small modifications to existing functions. The drop-side infrastructure is already complete. No architectural decisions or cross-file coordination required.

## Reviewer Pass

**Date:** 2025-07-14
**Reviewer:** Copilot (Principal Engineer review)

### Stage 1 — Grumpy Principal Engineer Findings

| # | Severity | Location | Finding |
|---|----------|----------|---------|
| 1 | ✅ PASS | `handleDragStart` (1514–1541) | Multi-select gating logic (`selectedCards.has && size > 1 && getSelectedInColumn`) matches plan exactly. Single-card fallback preserved. `application/json`, `text/plain`, and `application/switchboard-workspace-root` all set. |
| 2 | ✅ PASS | `handleDragEnd` (1543–1547) | `querySelectorAll('.kanban-card.dragging')` sweep replaces single `e.target` removal. Matches plan. |
| 3 | ✅ PASS | `handleDrop` (1710–1711) | `.selected` CSS class cleared, then `selectedCards.clear()` immediately follows. JS and DOM state in sync. |
| 4 | ✅ PASS | Single-card regression guard | Three-condition gate (`has`, `size > 1`, `length > 1`) ensures single-card drag is identical to pre-change behaviour. |
| 5 | ✅ PASS | `application/switchboard-workspace-root` | Line 1540 sets it unconditionally, using `dataset.workspaceRoot` with `getActiveWorkspaceRoot()` fallback. |

**No CRITICAL or MAJOR findings.** Implementation matches the plan specification on all five requirements.

### Stage 2 — Balanced Synthesis

All five plan requirements are satisfied with no deviations. The code is clean, the edge-case guards are conservative, and the existing `handleDrop` JSON parsing + try/catch fallback means even a corrupted payload degrades gracefully to single-card behaviour. Nothing to fix, defer, or dismiss.

### Stage 3 — Code Fixes

No fixes required. Implementation is plan-compliant.

### Stage 4 — Verification

- **`npm run compile`**: ✅ Both webpack bundles compiled successfully (extension.js + mcp-server.js), zero errors, zero warnings.

### Stage 5 — Summary

| Item | Detail |
|------|--------|
| Files reviewed | `src/webview/kanban.html` |
| Files changed | None (no fixes needed) |
| Build status | ✅ Pass |
| Plan compliance | 5/5 requirements met |
| Remaining risks | Theoretical `currentCards` staleness during mid-drag re-render (guarded by `if (card)` check; low probability due to full-board render approach) |
