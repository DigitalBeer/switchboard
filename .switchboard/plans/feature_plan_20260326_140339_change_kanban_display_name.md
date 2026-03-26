# Rename CLI-BAN to CLI-BAN Multi-Agent Pipeline

## Goal
Rename every user-facing occurrence of "CLI-BAN" to "CLI-BAN Multi-Agent Pipeline" across the VS Code extension source code, webview HTML, package manifest, and documentation. Additionally, remove the ⚡ lightning bolt symbol that appears inline in the board header title. The rename better reflects the tool's role as a multi-agent pipeline orchestration surface rather than a simple kanban display board. No functional behaviour changes; this is a pure cosmetic/branding rename.

## User Review Required
- Confirm the new name "CLI-BAN Multi-Agent Pipeline" is final.
- The phrase "CLI-BAN Routing Board" appears in README.md — should it become "CLI-BAN Multi-Agent Pipeline" alone? This plan assumes "CLI-BAN Multi-Agent Pipeline" replaces both "CLI-BAN" and "CLI-BAN Routing Board".
- The AUTOBAN feature name is **not** being renamed (it is a separate feature). Confirm this is intentional.

## Complexity Audit

### Routine
- **String replacement in source files** — Direct find-and-replace of a unique, unambiguous string literal across 5 source files. No logic changes, no API changes, no database migrations.
- **Documentation updates** — ~16 occurrences in README.md, 2 in docs/marketing.md. Purely textual.
- **CSS lightning bolt** — The `⚡` on line 806 of kanban.html is inline text in the header, trivially removed. The CSS `content: '⚡ '` on line 545 belongs to `.autoban-indicator.is-active::before` (the AUTOBAN button pulse animation) and is **unrelated** to the board title — it must be left alone.

### Complex / Risky
- **Incomplete grep coverage** — If any dynamically constructed strings (e.g. template literals, concatenation) produce "CLI-BAN" at runtime, a static search would miss them. Mitigated by grepping the entire `src/` tree and `dist/` output after build.
- **Cached webview content** — VS Code caches webview panels. After renaming the panel title in KanbanProvider.ts, any already-open panel retains the old title until the panel is re-created (window reload or re-open command). This is expected VS Code behaviour and not a bug.
- **package.json command title** — Changing the command title in `package.json` means users who have custom keybindings referencing the old title text (not the command ID) could be confused. The command ID `switchboard.openKanban` is **not** changing, so keybindings by ID are unaffected.

## Edge-Case & Dependency Audit
1. **AUTOBAN references** — "AUTOBAN" contains "BAN" but NOT "CLI-BAN". Grepping confirms zero false-positive overlap. The AUTOBAN button text, CSS class names (`.autoban-*`), and feature description must remain untouched.
2. **CSS `content: '⚡ '` on `.autoban-indicator.is-active::before`** (kanban.html line 545) — This selector targets only the AUTOBAN status indicator, not the board title. Removing it would break the AUTOBAN active-state visual indicator. **Do not modify this line.**
3. **The inline `⚡` on kanban.html line 806** — This is plain text inside the `#kanban-title` div. Removing it has no side effects on other elements.
4. **`dist/` directory** — Pre-built output may contain the old string. A rebuild (`npm run build` / webpack) will regenerate it. No manual edits to `dist/` needed.
5. **README anchor links** — The heading `### CLI-BAN Routing Board` (line 34) generates a GitHub anchor `#cli-ban-routing-board`. Any in-repo or external links to this anchor will break. Grep confirms no in-repo links to this anchor. External links are outside our control.
6. **VSIX package** — The checked-in `switchboard-1.5.0.vsix` contains the old name baked in. It should be rebuilt after these changes, but that is a release concern, not a code concern.

## Adversarial Synthesis

### Grumpy Critique
Oh wonderful, another rename ticket. Let me guess — someone had a *branding epiphany* during a standup and now I get to mass-replace a string across 23 files like it's 2004 and we just discovered `sed`. Let me enumerate the catastrophic risks of this *critical infrastructure change*:

1. **You're breaking the README anchor.** `### CLI-BAN Routing Board` generates `#cli-ban-routing-board` as a GitHub anchor. Anyone who bookmarked it — and I know at least one person did, because I did — gets a 404-to-nowhere scroll. Did anyone think about that? Of course not.
2. **The CSS lightning bolt inspection is the only interesting part of this entire plan**, and the original author almost got it wrong. Line 545 is `.autoban-indicator.is-active::before`, NOT the title. If someone just blindly searches for `⚡` and deletes all matches, the AUTOBAN pulse animation loses its icon. Congratulations, you've shipped a regression in a rename PR.
3. **The VSIX is checked into the repo.** After this rename, it's stale. Is anyone going to rebuild it? Or will we ship a VSIX that says "CLI-BAN" while the source says "Pipeline Builder"? Professionalism at its finest.
4. **Sixteen README occurrences.** That's sixteen chances to typo "Pipline Builder" or "Pipeline Buidler" or accidentally nuke a sentence. I trust no one to do this by hand without a review diff.
5. **"Pipeline Builder" is a terrible name.** It sounds like a Jenkins plugin from 2017. But sure, I'll rename it. I rename things. That's what principal engineers do apparently.

### Balanced Response
The critique raises valid operational points, but none are blocking:

1. **README anchor breakage** — True, but there are zero in-repo references to this anchor (confirmed by grep). External link breakage is a known, accepted cost of any heading rename. We can add a note in the PR description for documentation consumers.
2. **CSS lightning bolt** — The plan explicitly calls out that line 545 (`.autoban-indicator.is-active::before`) must NOT be touched. Only the inline `⚡` on line 806 is removed. This is correctly scoped.
3. **Stale VSIX** — Valid concern. The VSIX should be rebuilt as part of the next release cycle. This plan's scope is source code + docs; VSIX packaging is a separate release step.
4. **Typo risk in 16 README replacements** — Mitigated by using exact find-and-replace (not manual retyping) and verifying with `grep -c` post-change. The verification plan below includes this check.
5. **Name choice** — Product decision, out of scope for engineering review. The plan implements whatever name is chosen.

## Proposed Changes

### VS Code Extension Source — KanbanProvider
#### [MODIFY] `src/services/KanbanProvider.ts`
- **Context:** Line 118 — the webview panel title string passed to `vscode.window.createWebviewPanel()`.
- **Logic:** Replace the panel title so the VS Code tab reads "Pipeline Builder" instead of "CLI-BAN".
- **Implementation:** Change `'CLI-BAN'` → `'Pipeline Builder'` on line 118.
- **Edge Cases Handled:** The first argument `'switchboard-kanban'` is the internal panel type ID (not user-facing) and must remain unchanged. Only the second argument (display title) is modified.

### VS Code Extension Manifest
#### [MODIFY] `package.json`
- **Context:** Line 85 — the `title` field of the `switchboard.openKanban` command in the `contributes.commands` array.
- **Logic:** Update the command palette label so users see "Switchboard: Open Pipeline Builder" when searching commands.
- **Implementation:** Change `"Switchboard: Open CLI-BAN"` → `"Switchboard: Open Pipeline Builder"` on line 85.
- **Edge Cases Handled:** The `command` ID `switchboard.openKanban` is unchanged, so existing keybindings and programmatic invocations are unaffected.

### Webview — Kanban Board HTML
#### [MODIFY] `src/webview/kanban.html`
- **Context:** Line 806 — the board header title text inside the `#kanban-title` div.
- **Logic:** Remove the `⚡` lightning bolt prefix and replace "CLI-BAN" with "Pipeline Builder" in the header text.
- **Implementation:** Change `⚡ CLI-BAN - Drag plan cards to trigger CLI Agent actions | Copy prompts to send to IDE chat agents` → `Pipeline Builder - Drag plan cards to trigger CLI Agent actions | Copy prompts to send to IDE chat agents`.
- **Edge Cases Handled:** The `⚡` on line 545 (`content: '⚡ ';` in `.autoban-indicator.is-active::before`) is a completely separate CSS rule for the AUTOBAN button pulse and is **NOT modified**. Only the inline text on line 806 is changed.

### Webview — Implementation HTML
#### [MODIFY] `src/webview/implementation.html`
- **Context:** Line 1298 — the button text for the "Open Kanban" action in the sidebar implementation panel.
- **Logic:** Update button label to match the new name.
- **Implementation:** Change `OPEN CLI-BAN` → `OPEN PIPELINE BUILDER` on line 1298.
- **Edge Cases Handled:** The button ID `btn-open-kanban` and its click handler are unchanged. Only the visible text label is modified.

### Documentation — README
#### [MODIFY] `README.md`
- **Context:** 16 occurrences of "CLI-BAN" across lines 7, 21, 34, 36, 40, 44, 52, 59, 79, 83, 94, 98, 117, 118, 124, 141.
- **Logic:** Replace every occurrence of "CLI-BAN" with "Pipeline Builder". The heading on line 34 (`### CLI-BAN Routing Board`) becomes `### Pipeline Builder`. Compound phrases like "the CLI-BAN" become "the Pipeline Builder"; "CLI-BAN Routing Board" becomes "Pipeline Builder".
- **Implementation:** Exact find-and-replace of the following patterns:
  - `CLI-BAN Routing Board` → `Pipeline Builder` (lines 7, 34)
  - `CLI-BAN` → `Pipeline Builder` (all remaining 14 occurrences)
- **Edge Cases Handled:** "AUTOBAN" does not contain "CLI-BAN" and will not be affected by the replacement. The GitHub-generated anchor for the renamed heading will change from `#cli-ban-routing-board` to `#pipeline-builder`; no in-repo links reference the old anchor.

### Documentation — Marketing
#### [MODIFY] `docs/marketing.md`
- **Context:** 2 occurrences of "CLI-BAN" on lines 17 and 39.
- **Logic:** Replace both occurrences with "Pipeline Builder".
- **Implementation:**
  - Line 17: `**CLI-BAN**` → `**Pipeline Builder**`
  - Line 39: `CLI-BAN` → `Pipeline Builder`
- **Edge Cases Handled:** "AUTOBAN" on line 39 appears in the same sentence but is a distinct token and will not be affected.

## Verification Plan

### Automated Tests
1. **Post-change grep** — Run `grep -rn "CLI-BAN" src/ package.json README.md docs/` and confirm **zero** matches. Any match indicates an incomplete rename.
2. **AUTOBAN preservation** — Run `grep -rn "AUTOBAN" src/webview/kanban.html` and confirm the AUTOBAN references (button text, CSS classes) are intact and unchanged.
3. **Lightning bolt preservation** — Run `grep -n "⚡" src/webview/kanban.html` and confirm exactly **one** match remains: line 545 (`.autoban-indicator.is-active::before { content: '⚡ '; }`). Zero matches means the AUTOBAN indicator was incorrectly removed. Two or more means the title `⚡` was not removed.
4. **Build** — Run `npm run build` (webpack) and confirm it completes without errors. Check `dist/` output for zero occurrences of "CLI-BAN".
5. **Package validation** — Run `npx vsce ls` (if available) to list packaged files and confirm no errors in package.json command definitions.

### Manual Tests
1. **Command Palette** — Open VS Code, press `Cmd+Shift+P`, type "Switchboard". Confirm the command reads "Switchboard: Open Pipeline Builder".
2. **Webview Panel Tab** — Execute the command. Confirm the VS Code tab title reads "Pipeline Builder".
3. **Board Header** — Confirm the board header reads "Pipeline Builder - Drag plan cards to trigger CLI Agent actions | Copy prompts to send to IDE chat agents" with no ⚡ prefix.
4. **AUTOBAN Indicator** — Click START AUTOBAN. Confirm the ⚡ lightning bolt still appears on the autoban indicator when active.
5. **Implementation Panel Button** — Open the implementation sidebar panel. Confirm the button reads "OPEN PIPELINE BUILDER".
6. **README rendering** — Open README.md in GitHub preview. Confirm all 16 former "CLI-BAN" references now read "Pipeline Builder" and that the heading anchor `#pipeline-builder` works.

## Recommendation
**Send to Coder** — This is a straightforward, low-risk string rename across 7 files with no logic changes, no API changes, and no database impact. A single coder can complete and verify this in one pass.
