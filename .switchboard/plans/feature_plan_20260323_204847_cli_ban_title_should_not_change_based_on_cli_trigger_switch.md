# CLI-BAN title should not change based on cli trigger switch

## Goal
When the CLI trigger switch is turned off, the CLI-BAN header title (`⚡ CLI-BAN - Drag plan cards to trigger CLI Agent actions | Copy prompts to send to IDE chat agents`) loses its teal glow and becomes dimmed. This cosmetic side-effect is confusing — the toggle already has its own label, off-badge, and visual state. The title should remain visually unchanged regardless of the CLI trigger toggle state.

## User Review Required
> [!NOTE]
> Cosmetic-only change. The CLI trigger switch continues to function identically — only the title styling side-effect is removed. No breaking changes.

## Complexity Audit
### Band A — Routine
- Remove the `.kanban-title.triggers-off` CSS rule block (4 lines) from `src/webview/kanban.html`
- Remove the JS line that toggles the `triggers-off` class on the title element inside `updateCliToggleUi()` in `src/webview/kanban.html`

### Band B — Complex / Risky
- None

## Edge-Case & Dependency Audit
- **Race Conditions:** None. This is a pure CSS/DOM class removal with no async behavior.
- **Security:** No security implications. Purely cosmetic change.
- **Side Effects:** The `.kanban-title.triggers-off` CSS class is only applied in one place (`updateCliToggleUi`). Removing it has no downstream impact on other elements. The toggle label (`.is-off` class on `cli-toggle`), the off-badge (`triggers-off-badge`), and the checkbox state all remain unchanged and continue to communicate the toggle state to the user.
- **Dependencies & Conflicts:**
  - **`feature_plan_20260316_064358_have_cli_trigger_switch_at_top_of_kanban.md`** — This is the plan that originally introduced the CLI trigger switch and the title dimming behavior. Already implemented/coded. This plan reverses one cosmetic aspect of that implementation.
  - **`feature_plan_20260313_075806_make_kanban_subheader_more_information.md`** / **`feature_plan_20260316_091239_change_kanban_header.md`** — These plans modify the kanban header text content but do not touch the `.triggers-off` CSS class or the `updateCliToggleUi` function. No conflict.

## Adversarial Synthesis
### Grumpy Critique
- **[NIT]** This is a two-line deletion masquerading as a "plan". I've seen interns submit more complex lunch orders. But fine — at least it's scoped correctly.
- **[MAJOR]** Did anyone check whether the `.kanban-title.triggers-off` selector is referenced anywhere ELSE? A CSS class in a webview could theoretically be queried by JS via `classList.contains()` or `querySelector()`. If some other code path checks for `triggers-off` on the title to determine trigger state, you've just created an invisible regression. Show me the receipts.
- **[NIT]** The original developer clearly intended the title dimming as a "system status at a glance" indicator. Removing it means the ONLY visual cue that triggers are off is the tiny toggle switch and the off-badge. If a user scrolls past the controls strip and only sees the title, they won't know triggers are off. Is that actually what the user wants? The plan says yes — the toggle label is sufficient. Fine, but document the trade-off.

### Balanced Response
- **Re: other references to `triggers-off` on the title** — Verified via codebase search: the `triggers-off` class is only added/removed in `updateCliToggleUi()` at line 823 and styled at lines 65-68. No JS code reads it via `classList.contains()` or `querySelector('.triggers-off')` for logic decisions. The removal is safe.
- **Re: loss of at-a-glance status** — The toggle switch, its `.is-off` styling, and the `triggers-off-badge` (a visible badge element) all remain. These are the primary UX indicators. The title dimming was a secondary, subtle cue that the user explicitly finds confusing rather than helpful. Removing it is the correct UX call per the stated goal.
- **Conclusion:** The two deletions are safe and sufficient. No additional guards needed.

## Proposed Changes

### Kanban Webview — CSS Cleanup
#### [MODIFY] `src/webview/kanban.html`
- **Context:** The `.kanban-title.triggers-off` CSS rule (lines 65-68) dims the title color to 55% teal and removes `text-shadow` when CLI triggers are off. This cosmetic rule is the root cause of the reported issue.
- **Logic:** Delete the entire `.kanban-title.triggers-off` rule block. The base `.kanban-title` styles (lines 54-63) will apply unconditionally.
- **Implementation:**
  Remove these 5 lines (the blank line before and the 4-line rule block):

  ```diff
  --- a/src/webview/kanban.html
  +++ b/src/webview/kanban.html
  @@ -63,10 +63,6 @@
               text-shadow: var(--glow-teal);
           }

  -        .kanban-title.triggers-off {
  -            color: color-mix(in srgb, var(--accent-teal) 55%, var(--text-secondary));
  -            text-shadow: none;
  -        }
  -
           .header-controls {
  ```

- **Edge Cases Handled:** No other elements use the `.kanban-title.triggers-off` selector. Removing it is a clean deletion with no orphan references.

### Kanban Webview — JS Cleanup
#### [MODIFY] `src/webview/kanban.html`
- **Context:** The `updateCliToggleUi()` function (lines 808-825) toggles the `triggers-off` class on the title element at line 822-824. With the CSS rule removed, this class toggle is dead code and should be removed for cleanliness.
- **Logic:** Remove the 3 lines that query `titleEl` and toggle the class on it. The `toggle`, `toggleLabel`, and `offBadge` logic remain untouched.
- **Implementation:**
  Remove these lines from `updateCliToggleUi()`:

  ```diff
  --- a/src/webview/kanban.html
  +++ b/src/webview/kanban.html
  @@ -819,9 +819,6 @@
               if (offBadge) {
                   offBadge.hidden = !!cliTriggersEnabled;
               }
  -            if (titleEl) {
  -                titleEl.classList.toggle('triggers-off', !cliTriggersEnabled);
  -            }
           }
  ```

  Also remove the now-unused `titleEl` variable declaration at line 812:

  ```diff
  -            const titleEl = document.getElementById('kanban-title');
  ```

  The final `updateCliToggleUi()` function should read:

  ```javascript
  function updateCliToggleUi() {
      const toggle = document.getElementById('cli-triggers-toggle');
      const toggleLabel = document.getElementById('cli-toggle');
      const offBadge = document.getElementById('triggers-off-badge');
      if (toggle) {
          toggle.checked = !!cliTriggersEnabled;
      }
      if (toggleLabel) {
          toggleLabel.classList.toggle('is-off', !cliTriggersEnabled);
      }
      if (offBadge) {
          offBadge.hidden = !!cliTriggersEnabled;
      }
  }
  ```

- **Edge Cases Handled:** The `id="kanban-title"` attribute remains on the HTML element — it may be referenced elsewhere and is harmless. Only the JS class-toggle logic and the dead CSS rule are removed.

## Verification Plan
### Automated Tests
- No existing unit tests cover webview CSS styling. Manual verification required.

### Manual Verification
1. Open the Switchboard Kanban board in VS Code.
2. Confirm the title reads `⚡ CLI-BAN - Drag plan cards to trigger CLI Agent actions | Copy prompts to send to IDE chat agents` in full teal glow.
3. Toggle the CLI Triggers switch **OFF**.
4. Verify the title text **retains its teal color and glow** (no dimming, no style change).
5. Verify the toggle label shows its `.is-off` state and the off-badge appears — these indicators must still work.
6. Toggle CLI Triggers back **ON**. Verify no visual change to the title (it should look the same in both states).
7. Drag a card between columns with triggers OFF — confirm no CLI action fires (existing behavior preserved).
8. Drag a card with triggers ON — confirm CLI action fires (existing behavior preserved).

## Open Questions
- None. The scope is fully defined.

---

## Reviewer Pass — 2026-03-23

### Stage 1 — Grumpy Principal Engineer Findings

| ID | Severity | Finding | Status |
|:---|:---------|:--------|:-------|
| G1 | NIT | Double blank line left at former CSS rule location (lines 63-65) after deletion — inconsistent with single-blank-line convention in the rest of the file | **Fixed** |
| G2 | NIT | Plan line numbers are now stale post-deletion (e.g. "line 823", "lines 65-68") | Won't fix — diffs provide sufficient context |
| G3 | MAJOR→RESOLVED | Verified no orphan references to `triggers-off` class on the title element anywhere in codebase. Only remaining `triggers-off` references are for the `triggers-off-badge` element (CSS class, HTML element, JS getElementById) — all intentionally preserved | Safe |

### Stage 2 — Balanced Synthesis

- **Both planned deletions implemented correctly.** CSS rule `.kanban-title.triggers-off` removed. JS `titleEl` variable and `classList.toggle('triggers-off', ...)` removed from `updateCliToggleUi()`.
- **Function body matches plan's target exactly** (lines 804-817 post-fix).
- **No regressions.** Toggle `.is-off` class, `triggers-off-badge` visibility, and checkbox state all untouched.
- **One cosmetic fix applied:** collapsed double blank line to single blank line at former CSS rule location.

### Files Changed During Review
- `src/webview/kanban.html` — collapsed double blank line (NIT fix only, no functional change)

### Verification Results
- **TypeScript compilation (`tsc --noEmit`):** ✅ Pass (exit code 0)
- **Webpack production build:** ✅ Pass (`compiled successfully`)
- **Manual verification:** Required per plan — no automated webview CSS tests exist

### Remaining Risks
- None. All findings resolved or deferred as NITs. Implementation is complete and correct.
