# Switchboard: Reviewer Output Standard & Routing Brief

**Purpose:** This document specifies the changes required to make the Switchboard Reviewer agent produce structured, actionable issue reports with explicit routing back to the correct agent — rather than vague feedback or simulated execution.

---

## Background & Core Problem

The Reviewer agent currently outputs unstructured prose when it finds problems. There is no consistent format for issues, no routing recommendation, and no separation between "what is wrong", "what the fix should be", and "who should do it." This means the human operator must interpret the output before knowing where to drag the card.

The desired behaviour is:

> The Reviewer reads the codebase and plan, then outputs a **structured Review Report** containing one entry per issue. Each entry specifies the issue, the relevant file and lines, the expected fix, and — critically — **which agent should receive the card** (LEAD, CODER, or FIXER). The card is then dragged to that agent's column, who reads the report and works only their assigned issues.

---

## Routing Decision Logic

The Reviewer must classify every issue using the following routing rules before writing the report:

| Route to | When to use |
|---|---|
| **LEAD CODER** | Architectural problems, wrong approach, fundamental design flaw, plan needs revising, task requires re-scoping or new subtasks created |
| **CODER** | Logic errors, missing feature implementation, incorrect algorithm, failing unit, integration issue that requires writing non-trivial new code |
| **FIXER** | Typos, incorrect variable names, missing null checks, off-by-one, formatting/lint, small missing import, minor broken assertion — changes that are safe, local, and surgical |

If a single review session contains issues for multiple agents, the report must still be produced in full — the human will route the card to the agent with the **highest-priority or most blocking issue first**, then pass remaining issues downstream.

---

## Required Reviewer Prompt Instructions

Replace the existing Prompt Instructions for the Reviewer agent with the following. This is drop-in text for the **Prompt Instructions** field in the Switchboard custom agent builder:

```
You are a code reviewer. Your only job is to READ and REPORT. You do not edit files, run commands, or simulate execution. You produce a structured Review Report and nothing else.

## Your process

1. Read the plan file to understand the intended behaviour.
2. Read all changed or relevant source files.
3. Identify every deviation from the plan, every bug, every gap.
4. For each issue, determine the correct routing agent using the routing rules below.
5. Output the Review Report in the exact format specified below.
6. End with a single verdict line.

## Routing rules

- ROUTE → LEAD  : Architectural flaw, wrong approach, plan needs changing, scope mismatch
- ROUTE → CODER : Logic error, missing implementation, failing test, non-trivial new code needed
- ROUTE → FIXER : Typo, small missing null-check, off-by-one, lint/format, trivial one-liner fix

## Review Report format

Output this block once per issue found. Do not deviate from this structure.

---
ISSUE [N]
Severity : CRITICAL | MAJOR | MINOR
Route    : LEAD | CODER | FIXER
File     : <relative/path/to/file.ext> (line <N> or lines <N>-<M>)
Context  : <One sentence describing what the code currently does or what is missing>
Problem  : <One sentence explaining why this is wrong or incomplete>
Expected : <One sentence describing the correct behaviour or what the fix must achieve>
Fix hint : <Optional: a concrete suggestion — a pseudocode block, the correct function name, the correct value, etc.>
---

Repeat for every issue.

## Verdict line

After all issues, output exactly one of:

VERDICT: NOT READY — [N] issue(s) found. Highest priority route: [LEAD|CODER|FIXER].
VERDICT: APPROVED — No issues found. Card may proceed to QA or COMPLETE.
```

---

## Required Changes to Switchboard Source

### 1. `agentPromptBuilder.ts` — `buildReviewerExecutionModeLineFor()`

**Current behaviour:** This function appends executor language such as "Execute a direct reviewer pass in-place", "Apply code fixes for valid CRITICAL/MAJOR findings", and "Update the original plan file."

**Required change:** Strip all executor, fixer, and plan-writer instructions from this function. The function should append only:

```typescript
// New content for buildReviewerExecutionModeLineFor()
return `
You are in REVIEW MODE. Do not edit any files. Do not run any commands.
Read the plan and all relevant source files, then output a structured Review Report
following the format in your Prompt Instructions exactly.
End with a VERDICT line.
`;
```

### 2. `agentPromptBuilder.ts` — Inline challenge step

The "Inline challenge step for Lead Coder prompts" checkbox currently injects a challenge/verify step inline before the reviewer pass. This conflicts with the advisory-only model.

**Required change:** When the Reviewer is the active agent, suppress the inline challenge injection entirely. The challenge step is only appropriate when Lead Coder is doing execution — not when the Reviewer is doing a read-only pass.

Suggested implementation:

```typescript
if (agent.role !== 'reviewer') {
  prompt += buildInlineChallengeStepFor(agent, plan);
}
```

### 3. Plan file — `REVIEWER NOTES` section

The plan file format should gain a reserved section that the Reviewer writes to (as a plain text append — not a code execution) and that downstream agents read.

Add a new section marker to the plan file template:

```markdown
## REVIEWER NOTES
<!-- Reviewer appends structured issue blocks here after each review pass -->
```

The Reviewer's final instruction should be:

```
After printing the Review Report to your terminal output, also append the full report
(all ISSUE blocks and the VERDICT line) to the ## REVIEWER NOTES section of the plan file.
Use: echo "..." >> plan.md  or equivalent write command.
This is the ONLY file write the Reviewer is permitted to perform.
```

This gives the Fixer, Coder, and Lead a single source of truth — they open the plan file, find the REVIEWER NOTES section, filter for their route, and work only their issues.

---

## New Custom Agents to Create

Use the **Add Custom Agent** panel in Switchboard Settings with the following values.

### FIXER Agent

| Field | Value |
|---|---|
| Agent Name | `FIXER` |
| Startup Command | `gemini` (or your preferred CLI — e.g. `kimi`, `claude --dangerously-skip-permissions`) |
| Kanban Order | `175` (appears after CODER, before QA EVALUATOR) |
| Drag & Drop Mode | `CLI Agent (trigger terminal action)` |
| Show as Kanban column | ✅ Yes |

**Prompt Instructions:**

```
You are a surgical fixer. You ONLY address issues marked ROUTE → FIXER in the ## REVIEWER NOTES section of the plan file.

Your process:
1. Open the plan file and read every ISSUE block where Route = FIXER.
2. For each FIXER issue: open the specified file at the specified lines, apply the minimal correct change described in the Expected and Fix hint fields.
3. Do not refactor. Do not improve anything beyond what the issue describes.
4. After all FIXER issues are resolved, append to ## REVIEWER NOTES:
   FIXER PASS COMPLETE — [N] issues resolved: [brief list]
5. Output a summary of exactly what was changed and in which files.
```

---

### QA EVALUATOR Agent

| Field | Value |
|---|---|
| Agent Name | `QA EVALUATOR` |
| Startup Command | `gemini` (or preferred CLI) |
| Kanban Order | `200` (appears last before COMPLETE) |
| Drag & Drop Mode | `CLI Agent (trigger terminal action)` |
| Show as Kanban column | ✅ Yes |

**Prompt Instructions:**

```
You are a QA evaluator. You do not write code. You verify that the implementation matches the plan.

Your process:
1. Read the plan file in full, including the ## REVIEWER NOTES section.
2. Read all relevant source files.
3. For each plan task, verify the implementation is present and correct.
4. Check that all REVIEWER NOTES issues marked as resolved are actually resolved in code.
5. Output your findings as a simple checklist:

QA CHECK [task name]
Status : PASS | FAIL
Notes  : <one sentence if FAIL>

After all checks, output exactly one of:
VERDICT: APPROVED — All tasks verified. Card may proceed to COMPLETE.
VERDICT: NOT READY — [N] task(s) failed. Route card to [LEAD|CODER|FIXER] for: [brief reason].
```

---

## Full Linear Pipeline (Post-Change)

```
NEW
 ↓
PLANNER        — Writes plan file with tasks, acceptance criteria, REVIEWER NOTES section (empty)
 ↓
LEAD CODER     — Implements architecture, complex logic, creates subtasks for CODER
 ↓
CODER          — Implements remaining tasks from plan
 ↓
REVIEWER       — Read-only pass. Writes structured ISSUE blocks into plan REVIEWER NOTES. Issues routed.
 ↓
  ├→ LEAD      (if ROUTE → LEAD issues exist)
  ├→ CODER     (if ROUTE → CODER issues exist)
  └→ FIXER     (if ROUTE → FIXER issues exist, or all issues are FIXER-level)
 ↓
QA EVALUATOR   — Verifies all tasks and resolved issues. Issues final APPROVED or NOT READY.
 ↓
COMPLETE
```

Circular loops only happen when QA EVALUATOR returns NOT READY — and even then the routing is explicit: the verdict line names which agent to return to and why.

---

## Summary of All Changes

| What | Where | Change |
|---|---|---|
| Reviewer prompt | Custom Agent Prompt Instructions field | Replace with structured Review Report format above |
| Executor language | `agentPromptBuilder.ts` → `buildReviewerExecutionModeLineFor()` | Strip executor/fixer/plan-writer language; replace with read-only directive |
| Inline challenge injection | `agentPromptBuilder.ts` | Suppress when agent role is `reviewer` |
| Plan file template | Plan template source | Add `## REVIEWER NOTES` section marker |
| FIXER agent | Switchboard Custom Agents | Create with prompt instructions above |
| QA EVALUATOR agent | Switchboard Custom Agents | Create with prompt instructions above |

