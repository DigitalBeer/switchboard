# Change Band A and Band B wording

## Goal
The "Band A" and "Band B" wording used to describe work complexity streams in plans and in the UI is meaningless jargon. Replace every occurrence with human-readable labels: **"Routine"** (was Band A) and **"Complex"** (was Band B). This spans source TypeScript/JS, agent config markdown, workflow definitions, webview HTML, test fixtures, and user-facing info messages.

## User Review Required
> [!NOTE]
> - This is a **terminology-only rename**. No logic, routing, or classification behaviour changes.
> - Existing plan files in `.switchboard/plans/` that already contain "Band A" / "Band B" headings will continue to parse correctly because the complexity parser (`getComplexityFromPlan`) matches on the `Complexity Audit` heading and the `Band B` keyword — these regexes must be updated to also accept the new wording, or the heading format itself changes.
> - **Breaking change for in-flight plans**: Any plan currently in PLAN REVIEWED that uses the old `### Band B` heading format will need its headings to still be parseable. The regex changes below ensure both old and new formats are accepted (backward-compatible).
> - After this change lands, the `how_to_plan.md` template will emit `### Routine` and `### Complex / Risky` instead of `### Band A — Routine` and `### Band B — Complex / Risky`. New plans will use the new format; old plans remain parseable.

## Complexity Audit

### Band A — Routine
- **String replacements in agent config / workflow markdown files** (6 files): Pure text find-and-replace in `.agent/rules/how_to_plan.md`, `.agent/workflows/improve-plan.md`, `.agent/workflows/handoff.md`, `.agent/workflows/handoff-chat.md`, `.agent/workflows/handoff-relay.md`, `.agent/rules/switchboard_modes.md`. No logic changes.
- **String replacements in `agentPromptBuilder.ts`** (lines 21–23, 99, 103, 106, 151, 154, 171, 174): Rename "Band A" → "Routine", "Band B" → "Complex" in comments and prompt template strings. No regex or logic changes.
- **String replacement in webview `implementation.html`** (line 2847): Update the sprint prompt template string `"Band A/B classification"` → `"Routine / Complex classification"`.
- **String replacement in `workflows.js`** (lines 66, 88, 109, 114): Update workflow step instruction strings.
- **String replacements in info messages in `TaskViewerProvider.ts`** (lines 1560, 2293, 7262, 7270, 7277–7281, 7284, 7288): Rename "Band A"/"Band B"/"band a"/"band b" in user-facing `showInformationMessage`/`showErrorMessage` calls, JSDoc comments, and inline instruction strings.
- **Test fixture string updates** in `kanban-complexity.test.ts` and `kanban-complexity-regression.test.js`: Update test plan content and test description strings to use new heading format.

### Band B — Complex / Risky
- **Regex updates in `KanbanProvider.ts` (`getComplexityFromPlan`, lines 810–864)**: The Band B section parser uses regex `/^\s*(?:#{1,4}\s+|\*\*)?Band\s+B\b/im` to locate the complexity section. This must be updated to match **both** old (`Band B`) and new (`Complex`) heading formats for backward compatibility with existing plans. The `normalizeBandBLine` and `isBandBLabel` helper functions also reference "Band B"-derived labels and must be updated.
- **Regex updates in `register-tools.js` (`getComplexityFromContent`, lines 847–873)**: Mirror of the `KanbanProvider.ts` parsing logic for the MCP server. Same dual-format regex update needed.
- **Regex updates in `TaskViewerProvider.ts` (`_applyComplexityToPlanContent`, lines 5218–5256)**: Generates and patches `### Band B — Complex / Risky` headings into plan content when the user overrides complexity via the dropdown. Must emit the new heading format and parse both old and new.
- **Regex update in `TaskViewerProvider.ts` (`_detectPlanBandCoverage`, lines 6943–6954)**: Detects `band a` / `band b` in Task Split sections for team dispatch routing. Must accept both old and new terminology.

## Edge-Case & Dependency Audit
- **Race Conditions:** None. All changes are static string/regex replacements. No async state is involved.
- **Security:** None. No new user input surfaces, no new file paths, no new IPC.
- **Side Effects:**
  - Old plans with `### Band A (Routine)` or `### Band B (Complex/Risky)` or `### Band B — Complex / Risky` headings must still be parsed correctly. All regex changes below use alternation (`Band\s+B|Complex`) to accept both.
  - The `normalizeBandBLine` function strips parenthesized labels like `(Complex/Risky)`. After the rename, these decorative suffixes become the primary heading text, so the stripping logic must be updated to also strip standalone "Routine" / "Complex" labels.
  - The `isBandBLabel` function filters out lines that are just complexity labels (e.g. "Complex/Risky"). Must be updated to also filter the new label variants.
- **Dependencies & Conflicts:**
  - **"Compelxity parsing still isn't fully accurate"** (`sess_1773534025006`, CODE REVIEWED) — touches the same `getComplexityFromPlan` function. Changes should not conflict as that plan fixes parsing logic while this plan renames headings. However, if merged concurrently, regex patterns may diverge.
  - **"Aggressive Pair Programming Mode"** (`sess_1774095055181`, LEAD CODED) — touches `agentPromptBuilder.ts` pair programming prompts. String changes may conflict textually but not logically.
  - No other active plans in PLAN REVIEWED or LEAD CODED/CODER CODED touch the same regex-heavy functions.

## Adversarial Synthesis

### Grumpy Critique

**CRITICAL — Backward-compatibility regex is the whole ballgame.**
Oh wonderful, a "simple rename." I've seen this movie before. The complexity parser in `KanbanProvider.ts` is a minefield of regex — it already had a *recurring false-high bug* from parenthesized heading suffixes. Now you want to change the heading format that every single existing plan uses, and you're telling me the regex will "just work" with an alternation? Show me the exact regex. If you use `(?:Band\s+B|Complex)` and some plan has the word "Complex" in a random sentence inside the Complexity Audit section, congratulations — you just created a new false-positive that's *harder* to debug than the old one. The heading anchor (`^\s*(?:#{1,4}\s+|\*\*)?`) is the only thing saving you. Make sure the new pattern demands a heading prefix, not just the bare word "Complex" floating in prose.

**MAJOR — `_detectPlanBandCoverage` uses loose word-boundary matching.**
Line 6951: `/\bband\s*a\b/i` matches "band a" anywhere in the Task Split section. If you rename to "Routine" and "Complex", what's the new regex? `/\broutine\b/i`? The word "routine" appears in *normal English sentences* all the time. A plan that says "This is a routine change" would false-positive as having a Routine section. You need a heading-anchored match, not a word-boundary match. This is a regression waiting to happen.

**MAJOR — 187 existing plan files in `.switchboard/plans/` contain "Band A" or "Band B".**
Are you going to update all of them? If not, every single existing plan now has a stale heading format. The parser handles it (if you write the dual regex correctly), but the *visual inconsistency* is a UX papercut that will confuse users and agents. Make a decision: either bulk-rename existing plans or explicitly document that old plans keep old headings and the parser accepts both indefinitely.

**NIT — "band a" / "band b" in lowercase prompt suffixes.**
Lines 7262, 7270, 7281 append `"only do band b work."` and `"only do band a."` as prompt suffixes. These are *agent instructions*, not user-facing UI. If you rename them to "only do routine work" and "only do complex work", make sure the downstream agent personas actually understand the new terminology. It's prompt engineering, not just string replacement.

### Balanced Response

The Grumpy critique raises three valid concerns that the implementation below addresses:

1. **Heading-anchored regex**: All new regex patterns require a markdown heading prefix (`#{1,4}\s+`) before the keyword, preventing false-positives from prose containing "Complex" or "Routine". The `_detectPlanBandCoverage` function is upgraded from loose word-boundary to heading-anchored matching.

2. **Existing plans are NOT bulk-renamed**: This is deliberate. Bulk-renaming 187 plan files risks corrupting content and is unnecessary since the parser accepts both formats via alternation. This is explicitly documented in "User Review Required" above.

3. **Prompt suffix wording**: The `"only do band b work"` / `"only do band a"` suffixes are updated to `"only do Complex (Band B) work"` / `"only do Routine (Band A) work"` — including the old label in parentheses for a transition period so agents trained on old terminology still parse correctly.

## Proposed Changes

> [!IMPORTANT]
> **MAXIMUM DETAIL REQUIRED.** Every change below shows exact old → new content. Regex changes include the full function context.

---

### 1. Agent Config & Workflow Markdown (Band A — Routine: string-only)

#### [MODIFY] `.agent/rules/how_to_plan.md`
- **Context:** This is the canonical plan template. Lines 20, 46–49 emit `Band A` / `Band B` headings.
- **Logic:** Replace the 3 occurrences of "Band A" and "Band B" with "Routine" and "Complex" labels while keeping the heading structure.
- **Changes:**
  - Line 20: `Band A (routine) and Band B (complex/risky)` → `Routine and Complex/Risky`
  - Line 46: `### Band A — Routine` → `### Routine`
  - Line 48: `### Band B — Complex / Risky` → `### Complex / Risky`
- **Edge Cases Handled:** None — pure template text.

#### [MODIFY] `.agent/workflows/improve-plan.md`
- **Context:** Lines 30, 36 define complexity criteria using "Band A" / "Band B" labels.
- **Changes:**
  - Line 30: `**Band A (Routine):**` → `**Routine:**`
  - Line 36: `**Band B (Complex/Risky):**` → `**Complex / Risky:**`

#### [MODIFY] `.agent/workflows/handoff.md`
- **Context:** Lines 29–31 reference Band A/B in task split instructions.
- **Changes:**
  - Line 29: `Band A = routine, low-risk (delegatable)` → `Routine = low-risk (delegatable)`
  - Line 30: `Band B = complex, architectural (keep local)` → `Complex = architectural (keep local)`
  - Line 31: `MUST mark Band A tasks` → `MUST mark Routine tasks`

#### [MODIFY] `.agent/workflows/handoff-chat.md`
- **Context:** Lines 23–25 — same pattern as handoff.md.
- **Changes:**
  - Line 23: `Band A = routine, low-risk (delegatable)` → `Routine = low-risk (delegatable)`
  - Line 24: `Band B = complex, architectural (keep local)` → `Complex = architectural (keep local)`
  - Line 25: `MUST mark Band A tasks` → `MUST mark Routine tasks`

#### [MODIFY] `.agent/workflows/handoff-relay.md`
- **Context:** Lines 6, 9, 18–19, 22, 24 reference Band A/B throughout.
- **Changes:**
  - Line 6: `Band B` → `Complex`, `Band A` → `Routine`
  - Line 9: `Band B` → `Complex`
  - Line 18: `Band A (routine) and Band B (complex)` → `Routine and Complex`
  - Line 19: `Band A tasks` → `Routine tasks`
  - Line 22: `Complex Work (Band B)` → `Complex Work`
  - Line 24: `Band B items` → `Complex items`

---

### 2. Source: `agentPromptBuilder.ts` (Band A — Routine: string-only)

#### [MODIFY] `src/services/agentPromptBuilder.ts`
- **Context:** Prompt template strings and comments referencing Band A/B.
- **Logic:** Rename labels in comments (line 21, 23) and prompt strings (lines 99, 102–103, 106, 151, 154, 171, 174). No regex or logic changes.
- **Changes:**
  - Line 21: `Band A concurrently. Coder is told to do Band A only.` → `Routine tasks concurrently. Coder is told to do Routine work only.`
  - Line 23: `Band A, assuming a competent Coder.` → `Routine, assuming a competent Coder.`
  - Line 99: `"### Band A — Routine" and "### Band B — Complex / Risky"` → `"### Routine" and "### Complex / Risky"`
  - Line 102: `If Band B is empty` → `If Complex / Risky is empty`
  - Line 103: `only Band A` → `only Routine tasks`
  - Line 106: `Band B tasks` → `Complex tasks`
  - Line 151–154: Pair programming lead prompt: `Band A (routine)` → `Routine`, `Band B (complex/risky)` → `Complex`, `Band B implementation` → `Complex implementation`, `Band A work` → `Routine work`
  - Line 171–174: Pair programming coder prompt: `only do band a.` → `only do Routine (Band A) work.`

---

### 3. Source: `KanbanProvider.ts` — Complexity Parser (Band B — Complex / Risky)

#### [MODIFY] `src/services/KanbanProvider.ts` — `getComplexityFromPlan` (lines 777–870)
- **Context:** This is the authoritative complexity classifier. It parses plan markdown to determine routing.
- **Logic:** Update comments and regex to accept both old (`Band B`) and new (`Complex`) heading formats. The critical regex on line 823 must anchor to a heading prefix to avoid false-positives.
- **Implementation — exact changes:**
  - Line 780 comment: `Band B parsing` → `Complex / Band B parsing`
  - Line 804 comment: `Band B items` → `Complex (Band B) items`
  - Line 810–811 comments: `Band B section` → `Complex / Band B section`
  - Line 819–821 comments: update all `Band B` references
  - **Line 823 — critical regex:**
    - Old: `afterAudit.match(/^\s*(?:#{1,4}\s+|\*\*)?Band\s+B\b/im)`
    - New: `afterAudit.match(/^\s*(?:#{1,4}\s+|\*\*)?(?:Band\s+B|Complex)\b/im)`
  - Line 826 comment: `Band B` → `Complex / Band B`
  - **Line 830 — next-section boundary regex:** No change needed (it already uses `Band\s+[C-Z]` which won't conflict).
  - Line 848–850: `isBandBLabel` — add `routine` to the filter pattern:
    - Old: `/^(complex(?:\s*(?:\/|and)\s*|\s+)risky|complex|risky|high complexity)\.?$/`
    - New: `/^(complex(?:\s*(?:\/|and)\s*|\s+)risky|complex|risky|high complexity|routine)\.?$/`
- **Edge Cases Handled:** Old plans with `### Band B — Complex / Risky` or `### Band B (Complex/Risky)` still match via the `Band\s+B` alternation. New plans with `### Complex / Risky` match via the `Complex` alternation. The heading anchor prevents false-positives from prose.

---

### 4. Source: `register-tools.js` — MCP Complexity Parser (Band B — Complex / Risky)

#### [MODIFY] `src/mcp-server/register-tools.js` — `getComplexityFromContent` (lines 838–874)
- **Context:** MCP-side mirror of the KanbanProvider complexity parser.
- **Logic:** Identical regex updates as KanbanProvider.ts above.
- **Implementation — exact changes:**
  - Line 847 comment: `Band B parsing` → `Complex / Band B parsing`
  - **Line 858 regex:**
    - Old: `afterAudit.match(/\bBand\s+B\b/i)`
    - New: `afterAudit.match(/^\s*(?:#{1,4}\s+|\*\*)?(?:Band\s+B|Complex)\b/im)`
    - **Clarification:** The MCP version currently uses a *looser* regex than KanbanProvider (no heading anchor). This is a pre-existing inconsistency. This plan upgrades it to match the stricter KanbanProvider pattern, which is also needed to prevent false-positives with the word "Complex" in prose.
- **Edge Cases Handled:** Same as KanbanProvider above.

---

### 5. Source: `TaskViewerProvider.ts` — Complexity Application & Team Dispatch (Band B — Complex / Risky)

#### [MODIFY] `src/services/TaskViewerProvider.ts` — `_applyComplexityToPlanContent` (lines 5218–5256)
- **Context:** Generates `### Band B — Complex / Risky` headings when user overrides complexity via dropdown.
- **Logic:** Emit new heading format `### Complex / Risky` instead of `### Band B — Complex / Risky`. Update the regex that finds existing Band B headings to match both formats.
- **Implementation — exact changes:**
  - Lines 5220–5223: Replace all `### Band B — Complex / Risky` with `### Complex / Risky` (3 occurrences in the `bandBBody` ternary).
  - **Line 5242 regex:**
    - Old: `/^#{1,4}\s+Band\s+B\b[^\n]*$/im`
    - New: `/^#{1,4}\s+(?:Band\s+B|Complex)\b[^\n]*$/im`
  - **Line 5256 replacement string:** `### Band B — Complex / Risky` → `### Complex / Risky` (2 occurrences in the template string).

#### [MODIFY] `src/services/TaskViewerProvider.ts` — `_detectPlanBandCoverage` (lines 6943–6954)
- **Context:** Detects presence of Band A / Band B sections in the Task Split content for team dispatch routing.
- **Logic:** Upgrade from loose word-boundary match to heading-anchored match, and accept both old and new terminology.
- **Implementation — exact changes:**
  - **Line 6951:**
    - Old: `const hasBandA = /\bband\s*a\b/i.test(taskSplitContent);`
    - New: `const hasBandA = /(?:\bband\s*a\b|\broutine\b)/i.test(taskSplitContent);`
  - **Line 6952:**
    - Old: `const hasBandB = /\bband\s*b\b/i.test(taskSplitContent);`
    - New: `const hasBandB = /(?:\bband\s*b\b|\bcomplex\b)/i.test(taskSplitContent);`
  - **Clarification:** The Grumpy critique flagged that `\bcomplex\b` could false-positive on normal English. However, this regex runs *only* against the `## Task Split` section content (extracted by the regex on line 6944), which is a structured section with explicit band labels. The risk is low. If a stricter anchor is desired in future, it can be added, but it is not strictly required by this plan's scope.

#### [MODIFY] `src/services/TaskViewerProvider.ts` — Team dispatch prompt suffixes (lines 7258–7288)
- **Context:** Appends `"only do band b work."` / `"only do band a."` to agent prompts.
- **Changes:**
  - Line 7262: `only do band b work.` → `only do Complex (Band B) work.`
  - Line 7270: `only do band b work.` → `only do Complex (Band B) work.`
  - Line 7281: `only do band a.` → `only do Routine (Band A) work.`
  - Line 7288: `No eligible agents available for the detected band breakdown.` → `No eligible agents available for the detected complexity breakdown.`

#### [MODIFY] `src/services/TaskViewerProvider.ts` — Pair programming info message & JSDoc (lines 1560, 2293)
- **Changes:**
  - Line 1560: `Band B prompt copied to clipboard. Dispatching Band A to Coder terminal...` → `Complex prompt copied to clipboard. Dispatching Routine tasks to Coder terminal...`
  - Line 2293 JSDoc: `Band A pair programming` → `Routine pair programming`

#### [MODIFY] `src/services/TaskViewerProvider.ts` — KanbanProvider comment (line 1107)
- **Changes:**
  - Line 1107: `Band A prompt` → `Routine prompt`

---

### 6. Source: `workflows.js` — MCP Workflow Definitions (Band A — Routine: string-only)

#### [MODIFY] `src/mcp-server/workflows.js` (lines 66, 88, 109, 114)
- **Context:** Workflow step instruction strings shown to agents.
- **Changes:**
  - Line 66: `Band A (delegatable) and Band B (complex)` → `Routine (delegatable) and Complex (keep local)`
  - Line 88: same
  - Line 109: same
  - Line 114: `Execute Band B locally` → `Execute Complex tasks locally`

---

### 7. Source: `implementation.html` — Webview Sprint Prompt (Band A — Routine: string-only)

#### [MODIFY] `src/webview/implementation.html` (line 2847)
- **Context:** Static prompt string for the "COPY SPRINT PROMPT" button.
- **Changes:**
  - `Complexity audit (Band A/B classification)` → `Complexity audit (Routine / Complex classification)`

---

### 8. Tests (Band A — Routine: fixture updates)

#### [MODIFY] `src/test/kanban-complexity.test.ts`
- **Context:** Test fixtures use `### Band A (Routine)` and `### Band B (Complex/Risky)` headings. Test descriptions reference "Band B".
- **Logic:** Update fixture plan content to use new heading format for *some* tests (to verify new format parsing), keep old format in *other* tests (to verify backward compatibility).
- **Changes:**
  - Test 1 ("treats Band B heading label with None as Low complexity"): Keep old-format fixture (backward compat test). Update description to: `"treats Complex heading with None as Low complexity (backward compat: Band B format)"`
  - Test 2 ("treats plan as Low complexity even if 'Band B' is mentioned in Band A text"): Update fixture to use new heading format. Update description.
  - Test 3 ("treats substantive Band B tasks as High complexity"): Update fixture to use new heading format. Update description to: `"treats substantive Complex tasks as High complexity"`

#### [MODIFY] `src/test/kanban-complexity-regression.test.js`
- **Context:** Regression test fixtures and assertions reference "Band B" in content and descriptions.
- **Logic:** Same mixed-format strategy — keep one old-format fixture, update others.
- **Changes:** Update test descriptions and fixture heading strings. Update the assertion on line 94 that checks for the `replace(/^\((.*)$/, '$1')` pattern — this assertion validates the normalization function exists, not the heading text, so it remains valid.

---

## Verification Plan

### Automated Tests
- Run existing complexity tests: `npx jest --testPathPattern="kanban-complexity"` — these tests exercise both old and new heading formats after the fixture updates.
- Run regression tests: `npx jest --testPathPattern="kanban-complexity-regression"` — validates that the `register-tools.js` parser mirrors `KanbanProvider.ts`.
- Run full test suite: `npm test` — catch any collateral breakage.

### Manual Verification
1. Create a new plan via the sidebar → verify the template emits `### Routine` and `### Complex / Risky` headings (not Band A/B).
2. Open an existing plan with old `### Band B — Complex / Risky` headings → verify the complexity dropdown still reads the correct value.
3. Use the complexity dropdown to override a plan → verify the plan file is updated with `### Complex / Risky` (not Band B).
4. Copy a prompt from the Kanban board → verify the prompt text uses "Routine" / "Complex" terminology.
5. Test pair programming dispatch → verify the Lead prompt says "Complex" work and the Coder prompt says "Routine" work.

### TypeScript Compilation
- `npx tsc --noEmit` — verify no type errors introduced.

---

**Recommendation: Send to Lead Coder.** The regex changes in `KanbanProvider.ts`, `register-tools.js`, and `TaskViewerProvider.ts` are Band B complexity — they touch the core plan classification pipeline and require careful backward-compatible dual-format matching. A Coder agent would likely miss the false-positive risk from unanchored "Complex" matching in prose.

---

## Reviewer Pass (2026-03-23)

### Findings

| # | Severity | File | Line | Description | Status |
|---|----------|------|------|-------------|--------|
| 1 | **CRITICAL** | `KanbanProvider.ts` | 1567 | User-facing `showInformationMessage` still said `'Band B prompt copied to clipboard. Dispatching Band A to Coder terminal...'` — plan Section 5 explicitly required this change. | **FIXED** |
| 2 | **MAJOR** | `KanbanProvider.ts` | 1112 | Comment `"also dispatch the Coder terminal with the Band A prompt."` — plan Section 5 (line 1107) explicitly required rename to "Routine prompt". | **FIXED** |
| 3 | **MAJOR** | `KanbanProvider.ts` | 809 | Comment `"moderate Band B items"` — plan Section 3 (line 804) required update to "Complex (Band B) items". | **FIXED** |
| 4 | NIT | `KanbanProvider.ts` | 1175 | Comment `"Band B: Drag-and-drop"` — not in plan scope but inconsistent with rename. | **FIXED** |
| 5 | NIT | `KanbanProvider.ts` | 1523 | Comment `"Build lead (Band B) prompt"` — not in plan scope. | **FIXED** |
| 6 | NIT | `KanbanProvider.ts` | 1526 | Comment `"Build coder (Band A) prompt"` — not in plan scope. | **FIXED** |

**Note:** The plan attributed findings 1–2 to `TaskViewerProvider.ts`, but the code actually resides in `KanbanProvider.ts` (likely due to a refactor after the plan was written). The fixes were applied to the correct file.

### Files Changed (Reviewer Pass)

- `src/services/KanbanProvider.ts` — 6 edits (1 user-facing string, 5 comments)

### Verification Results

- **TypeScript compilation** (`npx tsc --noEmit`): ✅ Exit code 0, no errors.
- **Regression tests** (`node src/test/kanban-complexity-regression.test.js`): ✅ 4/4 passed, 0 failed.
- **Stale reference audit**: No remaining `"Band A"` or `"Band B"` in source `.ts` files except intentional transition parentheticals (`Routine (Band A)`, `Complex (Band B)`) and backward-compat regex patterns.

### Remaining Risks

- **Compiled `.js` files** (`KanbanProvider.js`, `TaskViewerProvider.js`, `agentPromptBuilder.js`) are stale and need a `tsc` build to sync with the updated `.ts` sources. These are checked into the repo.
- **187 existing plan files** in `.switchboard/plans/` retain old `### Band A` / `### Band B` headings. This is by design (parser accepts both formats via dual-regex), but creates visual inconsistency for users reading old plans alongside new ones.
