# Switchboard Pipeline Fix — Full Brief for an AI LLM

## Summary of the Problem

The user wants a **linear, drag-and-drop pipeline** in Switchboard where each agent iterates on the previous agent's output until the feature is done and tested. Currently the workflow is broken in a specific and fixable way:

### Root Cause

Switchboard's built-in **Reviewer role prompt is written as a reviewer-executor**. The prompt instructs the model to:
- "Apply code fixes for valid CRITICAL/MAJOR findings"
- "Run verification checks (typecheck/tests as applicable)"
- "Update the original plan file with fixed items, files changed, validation results"
- "Execute a direct reviewer pass in-place"

However, the Reviewer agent (running via `ollama run <model>:cloud` in a terminal) is **just a text-in/text-out LLM**. It has no filesystem access, cannot execute shell commands, and cannot actually write files. So when it says "I fixed X", "tests passed", or "I updated the plan file" — none of that happened. It is simulating execution it cannot perform.

This creates a broken feedback loop:
1. Coder/Lead Coder implements changes (real changes, files written).
2. Card is moved to Reviewer column.
3. Reviewer receives the plan + context, narrates as if it is running tests and applying fixes — but nothing changes on disk.
4. User believes work is done when it is not.
5. Nothing progresses.

### Secondary Issue

Several large agentic models (GLM-5, Qwen3.5, Qwen3-Coder, Minimax) aggressively emit phantom tool calls like `read_file()`, `run_terminal()` etc., because they are trained for agentic setups. In Switchboard's terminal-based pipeline, these tool calls are never executed — they either appear as broken text output or cause the model to stall waiting for a response from a tool layer that does not exist.

---

## What the User Wants

A **linear pipeline** where cards flow left-to-right through agent columns, each agent iterating on the previous one's real output:

```
NEW → PLANNER → CODER/LEAD CODER → REVIEWER (advisory only) → FIXER → QA/EVALUATOR → COMPLETE
```

- **Planner**: Breaks the task into a detailed plan with complexity assessment.
- **Coder / Lead Coder**: Reads the plan, writes real code to disk, runs tests, reports what changed.
- **Reviewer**: Reads the plan and the real code diffs. Produces a structured critique — issues found, proposed fixes with exact before/after code blocks or unified diffs. **Does NOT claim to have applied fixes. Does NOT claim to have run tests. Only proposes.**
- **Fixer** (new custom agent): Reads the Reviewer's critique and applies the proposed changes to the actual files. Runs tests. Reports results.
- **QA / Evaluator** (optional new custom agent): Final sanity check — does the implementation match the plan requirements? Verdict: Ready or Not Ready.

If the Fixer finds the Reviewer's proposed changes introduced new issues, it can flag that and the card can optionally loop back — but the default flow is linear.

---

## What Needs to Change

### 1. Rewrite the Reviewer Prompt

**File to change**: `src/services/agentPromptBuilder.ts` (and compiled `.js` equivalent)

**Locate the reviewer prompt builder function.** In the source it looks like:

```typescript
// Inside buildPrompt() or similar — the reviewer role case
if (role === 'reviewer') {
  return `${reviewerExecutionIntro}${batchExecutionRules}${reviewerExecutionMode}...`
}
```

The `reviewerExecutionMode` currently contains language like:
- "fix valid material issues in code when needed"
- "Apply code fixes for valid CRITICAL/MAJOR findings"
- "Run verification checks (typecheck/tests as applicable) and include results"
- "Update the original plan file with fixed items, files changed, validation results"

**Replace those instructions with advisory-only language:**

```
For each plan:
1. Use the plan file as the source of truth for the review criteria.
2. Stage 1 (Grumpy): adversarial findings, severity-tagged (CRITICAL/MAJOR/NIT), in a dramatic "Grumpy Principal Engineer" voice.
3. Stage 2 (Balanced): synthesize Stage 1 into actionable fixes — what to keep, what to fix now, what can defer.
4. For each CRITICAL or MAJOR finding, output a precise fix proposal:
   - The exact file path to change
   - A before/after code block showing the current code and the replacement
   - OR a unified diff block (diff -u format)
   Do NOT claim you have applied these fixes. Label them clearly as "PROPOSED FIX".
5. List the tests or commands that SHOULD be run to verify the fix, but do NOT claim to have run them.
6. Output a final verdict: READY FOR FIXER (if changes needed) or APPROVED (if no changes needed).

CRITICAL: You are a read-only reviewer. You cannot write files, run commands, or execute anything.
Do not use phrases like "I fixed", "I updated", "tests passed", "I applied".
Use phrases like "Proposed fix:", "This should be changed to:", "Run this to verify:".
```

**Also remove or reword** the "light mode" dispatch language that says "Do NOT write plan/review artifact files in light mode" — this phrase has been confusing models into thinking they are in some kind of execution mode when they are not. Replace it with a cleaner single instruction.

---

### 2. Create a Custom "Fixer" Agent in Switchboard

**Where**: Switchboard Settings → Custom Agent (as shown in the screenshot — the user already has this UI available).

**Agent Name**: `Fixer` (or `Review Fixer`)

**Startup Command**: 
```
ollama run mistral-large-3:675b-cloud
```
(or whichever model is working reliably as a code executor — currently `mistral-large-3:675b-cloud` is confirmed working)

**Kanban Order**: Set this to a value between the Reviewer column and COMPLETE — e.g. `175` if Reviewer is 150 and Complete is 200.

**Show as Kanban Column**: ✅ Checked — so it appears as its own column in the CLI-BAN.

**Drag & Drop Mode**: `CLI Agent (trigger terminal action)`

**Prompt Instructions** (paste into the "Prompt Instructions" field — these are appended when dispatched):

```
You are the Fixer agent. You receive a plan and a Reviewer critique containing PROPOSED FIX blocks.

Your job:
1. Read the plan file to understand the original requirements.
2. For each PROPOSED FIX in the Reviewer output:
   a. Locate the file mentioned.
   b. Apply the proposed change exactly as described.
   c. Do not invent new changes — only apply what the Reviewer proposed.
3. After applying all fixes, run the relevant tests or build commands specified by the Reviewer.
4. Report clearly:
   - Which files you changed and what you changed
   - Which tests passed or failed
   - Any fixes you could not apply and why
5. If all fixes are applied and tests pass, state: "FIXER COMPLETE — READY FOR QA"
   If tests fail or a fix could not be applied, state: "FIXER BLOCKED — reason: [reason]"

You have full access to the filesystem and terminal. Write files. Run commands. Do real work.
Do not simulate. Do not describe what you would do. Do it.
```

---

### 3. (Optional) Create a Custom "QA Evaluator" Agent

**Agent Name**: `QA Evaluator`

**Startup Command**: 
```
ollama run gemma3:27b
```
(or any model good at reading and judging — not a tool-calling model)

**Kanban Order**: Set higher than Fixer, just before COMPLETE.

**Show as Kanban Column**: ✅ Checked.

**Prompt Instructions**:

```
You are the QA Evaluator. You receive a completed plan.

Your job is a final pass only — not to write code.

1. Read the plan file.
2. Read the key implementation files listed in the plan.
3. Answer these questions:
   - Does the implementation match every requirement in the plan?
   - Are there any obvious bugs or regressions not caught by the Fixer?
   - Are there missing edge cases that should have been handled?
4. Output a structured verdict:
   - APPROVED: The implementation satisfies the plan. Ready to mark COMPLETE.
   - NOT READY: List the specific gaps. Do not invent issues — only flag genuine plan mismatches.

You are read-only. Do not write files or run commands.
Use clear, plain language. No theatrical Grumpy voice here — just a calm, thorough checklist.
```

---

### 4. Update the Kanban Column Order

After saving the Fixer and QA Evaluator custom agents with "Show as Kanban column" enabled, the CLI-BAN should now show:

```
NEW | PLANNED | LEAD CODER | CODER | CODE REVIEWED | FIXER | QA EVALUATOR | COMPLETE
```

Cards flow left to right. No mandatory back-and-forth unless QA returns NOT READY, in which case drag back to FIXER or CODER.

---

### 5. Anti-Tool-Call System Prompt Additions (For All Roles)

For any model that keeps emitting phantom `read_file()`, `run_terminal()`, `TOOL_CALL` blocks etc., add the following to the **Prompt Instructions** field of that agent in Switchboard settings:

```
IMPORTANT: You are running inside a plain terminal session. There is NO tool layer, NO function calling, NO MCP tools available.
Do NOT emit TOOL_CALL blocks, function_call JSON, or any tool invocation syntax.
Do NOT call read_file(), run_terminal(), write_file(), or any similar functions.
You receive all file context inline in this prompt. Respond with code and text only.
If you need to reference a file, reference the content already provided in this prompt.
```

Add this at the top of the Prompt Instructions field for Lead Coder and Coder if those models keep emitting tool calls.

---

## Summary Table of Changes

| What | Where | Change Type |
|------|-------|-------------|
| Reviewer prompt | `src/services/agentPromptBuilder.ts` | Rewrite — advisory only, no "apply fixes" language |
| Light mode dispatch text | `src/services/agentPromptBuilder.ts` | Simplify — remove confusing executor framing |
| Fixer agent | Switchboard Settings → Custom Agent | New — applies Reviewer's proposed fixes for real |
| QA Evaluator agent | Switchboard Settings → Custom Agent | New (optional) — final read-only verdict |
| Anti-tool-call instruction | Agent Prompt Instructions in UI | Add to any model emitting phantom tool calls |

---

## Files Confirmed in Switchboard Source

From the source code and documentation:
- Prompt building: `src/services/agentPromptBuilder.ts` / `agentPromptBuilder.js`
- Agent config: `src/services/agentConfig.ts` / `agentConfig.js`  
- Workflow runtime: `src/mcp-server/workflows.js`
- Kanban state: `src/services/KanbanDatabase.ts` / `KanbanDatabase.js`
- Reviewer prompt specifically references: `buildReviewerExecutionIntro()`, `buildReviewerExecutionModeLineFor()` functions in `agentPromptBuilder`

The key function to edit is `buildReviewerExecutionModeLineFor()` — replace its output with the advisory-only reviewer instructions above.

---

## End Goal

After these changes, the user should be able to:
1. Create a plan card.
2. Drag it through: Planner → Coder → Reviewer → Fixer → QA → Complete.
3. Each agent does only its job — no agent pretends to do another agent's job.
4. Real code changes happen in the Coder and Fixer stages only.
5. The board accurately reflects where work actually is.
