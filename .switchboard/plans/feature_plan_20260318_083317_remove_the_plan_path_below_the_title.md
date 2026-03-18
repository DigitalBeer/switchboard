# Remove the plan path below the title

## Goal
The plan path below the title in the ticket view is redundant with the copy link button right next to it, and only serves to take up vertical space. It needs to be removed to streamline the page a bit more. 

## Proposed Changes

### Step 1: Identify and remove the plan path display element
**File:** `src/webview/review.html`

The plan path is displayed in the ticket detail view header area. Look for a DOM element that renders `planFileAbsolute` or a file path below the ticket title (`.ticket-title` or similar). This is likely a `<div>` or `<span>` element with a class like `.plan-path` or `.file-path`.

Based on the ticket data structure in `TaskViewerProvider.ts` (line 5281), `planFileAbsolute` is included in the review ticket data. The review.html webview receives this via the `setTicketData` message and renders it below the title.

**Action:** Remove the DOM element that displays the plan path. This is likely around lines 450–470 in review.html (header area near the title and action buttons).

### Step 2: Verify the copy link button still works
**File:** `src/webview/review.html`

The "Copy" button (or copy link icon) that copies the plan path to clipboard must continue to work independently of the removed display element. It sends a `copyPlanLink` message with the `planFileAbsolute` from state — this should be unaffected by removing the visual display.

### Step 3: Remove any CSS for the plan path element
**File:** `src/webview/review.html` — `<style>` section

Delete any CSS rules targeting the plan path element class (e.g., `.plan-path`, `.file-path-display`).

## Verification Plan
- Open a ticket in the ticket view.
- Confirm the plan path text no longer appears below the title.
- Confirm the copy link button still copies the correct path.
- Confirm no layout shift or empty space where the path used to be.
- Confirm the title is still displayed correctly.

## Open Questions
- None — this is a straightforward removal.

## Complexity Audit
**Band A (Routine)**
- Single-file change: remove one DOM element and its CSS in `review.html`.
- No logic changes, no backend changes.
- Low risk: removing a display element that is already redundant with an adjacent button.

## Dependencies
- None. No other plans reference the plan path display.

## Adversarial Review

### Grumpy Critique
1. "The plan path is useful for quick visual confirmation that you're looking at the right file. The copy button requires a click to see the path. Are you sure removing it is the right call?"

### Balanced Synthesis
1. **Partially valid — but the user explicitly requested removal.** The path is long and takes up vertical space. Users who need to see it can hover over the copy button (if it has a tooltip showing the path) or click to copy. If there's concern, the path could be shown in a tooltip on the title itself instead of as a separate line.

## Agent Recommendation
**Coder** — Single-element DOM removal. Minimal risk.
