# Code reviewed column is still out of alignment

## Goal
The empty icon button area for the code reviewed column is smaller in vertical height than the other columns that have buttons, leading to the code reviewed column being out of alignment. Make this empty area the same height as the other columns by adding an invisible icon button to force the flexbox container to match the exact dimensions of the other columns.

## User Review Required
> [!NOTE]
> Purely cosmetic UI fix. No functional changes.

## Complexity Audit
### Band A — Routine
- Add an invisible `button` with an image inside the `.column-button-area` of the last column to force consistent height and padding computation.
### Band B — Complex / Risky
- None

## Edge-Case & Dependency Audit
- **Race Conditions:** None.
- **Security:** None.
- **Side Effects:** None.
- **Dependencies & Conflicts:** This modifies `kanban.html` inline script strings.

## Adversarial Synthesis
### Grumpy Critique
"Oh great, a hacky invisible button. 'Just use an invisible icon,' the user says. CSS `min-height` exists for a reason, but clearly someone botched the flexbox or padding! Fine, if you're going to use an invisible button, make sure it has `visibility: hidden; pointer-events: none;` so it doesn't accidentally intercept clicks or get tab-focused by accessibility readers. If you screw up the `tabindex` or leave it clickable, users will be complaining about ghost buttons in the Review column!"

### Balanced Response
"Grumpy's point about accessibility and interaction is critical. We will add the invisible button as requested to guarantee pixel-perfect height matching across all browsers and rendering engines, but we will add `visibility: hidden; pointer-events: none; tabindex="-1"` to ensure it creates no side effects for screen readers or mouse interactions."

## Proposed Changes
> [!IMPORTANT]
> **MAXIMUM DETAIL REQUIRED:** Provide complete, fully functioning code blocks. Break down the logic step-by-step before showing code.

### `src/webview/kanban.html`
#### MODIFY `src/webview/kanban.html`
- **Context:** The `kanban.html` generates the column HTML. When a column is the last column, it renders an empty `<div class="column-button-area"></div>` which computes a different layout height than columns with buttons.
- **Logic:** We will replace the empty div with a div containing a hidden replica of a standard column button.
- **Implementation:**
```javascript
                let buttonArea = '';
                if (!isLastColumn) {
                    const julesBtn = (isPlanReviewed && lastVisibleAgents.jules !== false)
                        ? `<button class="column-icon-btn" data-action="julesSelected" data-column="${escapeAttr(def.id)}" title="Send selected plans to Jules">
                               <img src="${ICON_JULES}" alt="Jules">
                           </button>`
                        : '';
                    const analystMapBtn = (isPlanReviewed && lastVisibleAgents.analyst !== false)
                        ? `<button class="column-icon-btn" data-action="analystMapSelected" data-column="${escapeAttr(def.id)}" title="Generate context map for selected plans">
                               <img src="${ICON_ANALYST_MAP}" alt="Analyst Map">
                           </button>`
                        : '';
                    buttonArea = `<div class="column-button-area">
                        <button class="column-icon-btn" data-action="moveSelected" data-column="${escapeAttr(def.id)}" title="Move selected plans to next stage (triggers CLI if enabled)">
                            <img src="${ICON_MOVE_SELECTED}" alt="Move Selected">
                        </button>
                        <button class="column-icon-btn" data-action="moveAll" data-column="${escapeAttr(def.id)}" title="Move all plans in this column to next stage">
                            <img src="${ICON_MOVE_ALL}" alt="Move All">
                        </button>
                        <button class="column-icon-btn" data-action="promptSelected" data-column="${escapeAttr(def.id)}" title="Copy prompt for selected plans and advance to next stage">
                            <img src="${ICON_PROMPT_SELECTED}" alt="Prompt Selected">
                        </button>
                        <button class="column-icon-btn" data-action="promptAll" data-column="${escapeAttr(def.id)}" title="Copy prompt for all plans in this column and advance">
                            <img src="${ICON_PROMPT_ALL}" alt="Prompt All">
                        </button>
                        ${julesBtn}
                        ${analystMapBtn}
                    </div>`;
                } else {
                    buttonArea = `<div class="column-button-area">
                        <button class="column-icon-btn" style="visibility: hidden; pointer-events: none;" tabindex="-1" aria-hidden="true">
                            <img src="${ICON_MOVE_SELECTED}" alt="">
                        </button>
                    </div>`;
                }
```
- **Edge Cases Handled:** `pointer-events: none`, `tabindex="-1"`, and `aria-hidden="true"` prevent the invisible button from being interacted with or causing accessibility issues.

## Verification Plan
### Automated Tests
- Visually verify that the "Reviewed" column header is precisely the same height as the other columns in the webview.

## Open Questions
- None

---

## Code Review (2026-03-21)

### Stage 1 — Grumpy Principal Engineer

> "Oh, so you went and added the invisible button. Fine. BUT — and this is a *glorious* oversight — you FORGOT `tabindex="-1"`! The plan EXPLICITLY said `visibility: hidden; pointer-events: none; tabindex="-1"`. You got two out of three. You know what that means? On keyboard navigation, a screen-reader user tabs through Move Selected, Move All, Prompt Selected, Prompt All... and then lands on a GHOST BUTTON in the Reviewed column that does ABSOLUTELY NOTHING. They can't see it. They can't click it. But their focus ring is sitting on an invisible phantom. That's not just sloppy — that's an accessibility lawsuit waiting to happen!"
>
> "Also, I see you have a CSS rule `.kanban-column:last-child .column-button-area { height: 32px; min-height: 32px; }` at line 537. Now that you've got the invisible button forcing the height, this CSS rule is *redundant*. It won't break anything, but it's dead weight. NIT."
>
> - **[MAJOR]** Missing `tabindex="-1"` on the invisible button — keyboard focus can land on an invisible, non-functional element.
> - **[NIT]** The explicit CSS height rule on `.kanban-column:last-child .column-button-area` is now redundant given the invisible button approach.

### Stage 2 — Balanced Synthesis

Grumpy's MAJOR finding is valid and was fixed. The `tabindex="-1"` attribute was added to the invisible button at `kanban.html:960`. The NIT about the redundant CSS rule is acknowledged but deferred — removing it risks unintended side effects if the invisible button is ever removed, and it acts as a safety net.

### Fixed Items
- **[MAJOR] `tabindex="-1"` added** to the invisible button in `src/webview/kanban.html:960`

### Files Changed
- `src/webview/kanban.html` — Added `tabindex="-1"` to the invisible placeholder button

### Validation Results
- `tsc --noEmit`: **PASS** (exit code 0)
- All kanban test suites (9/9): **PASS**
- Visual verification: deferred to manual check (webview rendering)

### Remaining Risks
- **[NIT/DEFERRED]** Redundant CSS height rule at line 537-539 — cosmetic only, safe to leave