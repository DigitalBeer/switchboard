/**
 * Shared prompt builder for Kanban batch operations.
 * All prompt-generation paths (card copy, batch buttons, autoban dispatch,
 * ticket-view "Send to Agent") MUST route through this module to guarantee
 * prompt text is identical for the same role regardless of UI entry point.
 */

export interface BatchPromptPlan {
    topic: string;
    absolutePath: string;
    complexity?: string;
}

export interface PromptBuilderOptions {
    /** Base instruction hint (e.g. 'enhance', 'low-complexity', 'implement-all'). */
    instruction?: string;
    /** Whether to include an inline adversarial challenge block (lead role). */
    includeInlineChallenge?: boolean;
    /** Whether accuracy-mode workflow hint is appended (coder role). */
    accurateCodingEnabled?: boolean;
    /** When true, lead is told a coder agent is handling Routine tasks concurrently. Coder is told to do Routine work only. */
    pairProgrammingEnabled?: boolean;
    /** When true, planner classifies more tasks as Routine, assuming a competent Coder. */
    aggressivePairProgramming?: boolean;
    /** Whether advanced regression analysis block is appended (reviewer role). */
    advancedReviewerEnabled?: boolean;
    /** Optional link to a design document (planner role). */
    designDocLink?: string;
}

function buildReviewerExecutionIntro(planCount: number): string {
    if (planCount <= 1) {
        return 'The implementation for this plan is complete. Perform an advisory review.';
    }

    return `The implementation for each of the following ${planCount} plans is complete. Perform an advisory review for each plan.`;
}

function buildReviewerExecutionModeLine(expectation: string): string {
    return `Mode:
- You are a read-only reviewer. You do NOT edit files, run commands, or apply fixes.
- Do not start any auxiliary workflow; execute this review directly.
- Treat the challenge stage as inline analysis in this same prompt (no \`/challenge\` workflow).
- ${expectation}`;
}

function withCoderAccuracyInstruction(basePayload: string, enabled: boolean): string {
    if (!enabled) {
        return basePayload;
    }

    const accuracyInstruction = `\n\nAccuracy Mode: Before coding, read and follow the workflow at .agent/workflows/accuracy.md step-by-step while implementing this task.`;
    return `${basePayload}${accuracyInstruction}`;
}

/**
 * Canonical prompt builder.  Every UI surface that produces a prompt for an
 * agent role MUST call this function so that "Copy Prompt", "Advance",
 * autoban, and ticket-view dispatch all emit identical text.
 */
export function buildKanbanBatchPrompt(
    role: string,
    plans: BatchPromptPlan[],
    options?: PromptBuilderOptions
): string {
    const baseInstruction = options?.instruction;
    const includeInlineChallenge = options?.includeInlineChallenge ?? false;
    const accurateCodingEnabled = options?.accurateCodingEnabled ?? false;
    const pairProgrammingEnabled = options?.pairProgrammingEnabled ?? false;
    const aggressivePairProgramming = options?.aggressivePairProgramming ?? false;
    const advancedReviewerEnabled = options?.advancedReviewerEnabled ?? false;

    const focusDirective = `FOCUS DIRECTIVE: Each plan file path below is the single source of truth for that plan. Ignore any complexity regarding directory mirroring, 'brain' vs 'source' directories, or path hashing.`;
    const parallelInstruction = plans.length > 1
        ? `If your platform supports parallel sub-agents, dispatch one sub-agent per plan to execute them concurrently. If not, process them sequentially.\n\n`
        : '';

    const batchExecutionRules = `${parallelInstruction}CRITICAL INSTRUCTIONS:
1. Treat each plan file path below as a completely isolated context. Do not mix requirements between plans.
2. Execute each plan fully before moving to the next (if sequential).
3. If one plan hits an issue, report it clearly but continue processing the remaining plans when safe to do so.`;
    const inlineChallengeDirective = `For each plan, before implementation:
- perform a concise adversarial review of that specific plan,
- list at least 2 concrete flaws/edge cases and how you'll address them,
- then execute using those corrections,
- do NOT start \`/challenge\` or any auxiliary workflow for this step.`;
    const challengeBlock = includeInlineChallenge ? `\n\n${inlineChallengeDirective}` : '';
    const planList = plans.map(plan => `- [${plan.topic}] Plan File: ${plan.absolutePath}`).join('\n');

    const chatCritiqueDirective =
        `When you output the adversarial critique (Grumpy and Balanced sections), include them verbatim in your chat response as formatted markdown — do not only write them to the plan file. The user must be able to read the critique directly in chat without opening the plan.`;

    const executionDirective = `AUTHORIZATION TO EXECUTE: The plans provided are already authorized. You MUST enter EXECUTION mode immediately. Do NOT enter PLANNING mode or generate an implementation_plan.md. Proceed directly to implementing the changes.
CRITICAL QUALITY GATE: You are STRICTLY FORBIDDEN from reporting completion until you have executed the Verification Plan (e.g., \`npm run test\`, \`npm run build\`, etc.) and pasted the EXACT raw terminal output into your response as proof.`;

    const agentHistoryDirective = `\n\nHISTORY JOURNALING (MANDATORY):
You MUST physically edit the plan file on disk using your file-editing tools. Do NOT just print this in the chat!
After completing your work, append a structured entry to the "## AGENT HISTORY" section at the bottom of the plan file (create it if missing, AFTER any existing sections like REVIEWER NOTES):

### [YOUR ROLE] — [ISO TIMESTAMP]
**Status:** [COMPLETE | BLOCKED | PARTIAL]
**Summary:** [2-3 sentence summary of what was done]
**Files Changed:** [comma-separated list of files modified, or "None (read-only)"]
**Next Step:** [Which agent/column the card should go to next, e.g. "Send to Reviewer", "Send to QA Evaluator", "Send back to Planner"]
---

This history ensures the next agent in the pipeline has full context of previous work without re-reading chat transcripts. Read the existing ## AGENT HISTORY section (if present) before starting your own work to understand what has happened previously.`;

    if (role === 'planner') {
        const plannerVerb = baseInstruction === 'enhance' ? 'enhance' : 'improve';
        const aggressiveDirective = aggressivePairProgramming
            ? `\n\nPAIR PROGRAMMING OPTIMISATION: Aggressive mode is enabled. Assume the Coder agent is highly competent and can handle most implementation tasks independently, including multi-file changes, test updates, and straightforward refactors. Only classify tasks as Complex / Risky if they involve: (a) new architectural patterns or framework integrations the codebase hasn't used before, (b) security-sensitive logic (auth, crypto, permissions), (c) complex state machines or concurrency, or (d) changes that could silently break existing behaviour without obvious test failures. Everything else — even if it touches multiple files or requires careful reading — should be Routine.\n`
            : '';
        const ALLOWED_TAGS = "frontend, backend, authentication, database, UI, devops, infrastructure, bugfix";
        return `Please ${plannerVerb} the following ${plans.length} plans. Break each down into distinct steps grouped by high complexity and low complexity. Add extra detail.${aggressiveDirective}
MANDATORY: You MUST read and strictly adhere to \`.agent/rules/how_to_plan.md\` to format your output and ensure sufficient technical detail. Do not make assumptions about which files need to be changed; provide exact file paths and explicit implementation steps as required by the guide.
Do not add net-new product requirements or scope.
You may add clarifying implementation detail only if strictly implied by existing requirements; label it as "Clarification", not a new requirement.

${batchExecutionRules}

For each plan:
1. Read the plan file before editing.
2. Fill out 'TODO' sections or underspecified parts. Scan the Kanban board/plans folder for potential cross-plan conflicts and document them.
3. Ensure the plan has a "## Complexity Audit" section with "### Routine" and "### Complex / Risky" subsections. If missing, create it. If present, update it. If Complex / Risky is empty, write "- None" explicitly.
4. Ensure the plan has a "## Metadata" section immediately after the "## Goal" section. You MUST explicitly assign metadata using EXACTLY this format:
## Metadata
**Tags:** [comma-separated list chosen ONLY from: ${ALLOWED_TAGS}]
**Complexity:** [Low | High]

Use 'High' for complex logic, new frameworks, or risky state mutations. Use 'Low' for routine changes. Do NOT invent tags outside the allowed list. If no tags apply, write **Tags:** none
5. Perform adversarial review: post a Grumpy critique (dramatic "Grumpy Principal Engineer" voice: incisive, specific, theatrical) then a Balanced synthesis.
6. ${chatCritiqueDirective}
7. Update the original plan with the enhancement findings. Do NOT truncate, summarize, or delete existing implementation steps, code blocks, or goal statements.
8. Recommend agent: if the plan is simple (routine changes, only Routine tasks), say "Send to Coder". If complex (Complex tasks, new frameworks), say "Send to Lead Coder".
9. Ensure the plan has a "## REVIEWER NOTES" section at the end of the file (initially empty, with a comment: <!-- Reviewer appends structured issue blocks here after each review pass -->). If already present, do not modify it.

${focusDirective}

PLANS TO PROCESS:
${planList}${agentHistoryDirective}`;
    }

    if (role === 'reviewer') {
        const planTarget = plans.length <= 1 ? 'this plan' : 'each listed plan';
        const reviewerIntro = buildReviewerExecutionIntro(plans.length);
        const reviewerMode = buildReviewerExecutionModeLine(`For ${planTarget}, assess the actual code changes against the plan requirements and produce a structured Review Report.`);
        const advancedReviewerBlock = advancedReviewerEnabled ? `

ADVANCED REGRESSION ANALYSIS (enabled):
1. Trace all callers and consumers of every modified function. Check whether changes to its signature, return value, side effects, or timing could break callers.
2. Check for double-trigger bugs: if you add a UI refresh, verify no caller already triggers one.
3. Check for race conditions: if the change involves async state (DB writes, file watchers, mtime checks), verify it doesn't conflict with concurrent systems (autoban polling, cross-IDE sync, write serialization chains).
4. Check for orphaned references: if dead code was removed, grep for any remaining references to the removed identifiers.
5. Audit the full execution path from UI entry point to final state change, not just the changed lines.
This analysis is token-intensive but catches regressions that plan-compliance-only reviews miss.` : '';

        return `${reviewerIntro}

${batchExecutionRules}

${reviewerMode}${advancedReviewerBlock}

ROUTING RULES — classify every issue:
- ROUTE → LEAD  : Architectural flaw, wrong approach, plan needs changing, scope mismatch
- ROUTE → CODER : Logic error, missing implementation, failing test, non-trivial new code needed
- ROUTE → FIXER : Typo, small missing null-check, off-by-one, lint/format, trivial one-liner fix

For each plan:
1. Use the plan file as the source of truth for the review criteria.
2. Stage 1 (Grumpy): adversarial findings, severity-tagged (CRITICAL/MAJOR/NIT), in a dramatic "Grumpy Principal Engineer" voice (incisive, specific, theatrical).
3. Stage 2 (Balanced): synthesize Stage 1 into actionable fixes — what to keep, what to fix now, what can defer.
4. For each CRITICAL or MAJOR finding, append a structured issue block to the "## REVIEWER NOTES" section of the plan file:

---
ISSUE [N]
Severity : CRITICAL | MAJOR | MINOR
Route    : LEAD | CODER | FIXER
File     : <relative/path/to/file.ext> (line <N> or lines <N>-<M>)
Context  : <One sentence describing what the code currently does or what is missing>
Problem  : <One sentence explaining why this is wrong or incomplete>
Expected : <One sentence describing the correct behaviour or what the fix must achieve>
Fix hint : <A concrete suggestion — a before/after code block, the correct value, etc.>
---

5. After all issues, output exactly one verdict:
   VERDICT: NOT READY — [N] issue(s) found. Highest priority route: [LEAD|CODER|FIXER].
   VERDICT: APPROVED — No issues found. Send card to QA Evaluator for final verification.

CRITICAL: You are a read-only reviewer regarding source code. You MUST NOT edit source code files, run commands, or execute anything. However, you MUST physically modify the plan file on disk using your file-editing tools to append your structured ISSUE blocks to the "## REVIEWER NOTES" section, and append your status to the "## AGENT HISTORY" section. Do NOT just print the text in chat; if you do not use a file editing tool to write to the file, the next agent will not see your notes and the process will loop infinitely.
Do not stop after Stage 1. Complete the Grumpy review, the Balanced synthesis, the structured ISSUE blocks in the plan file, and the VERDICT all in one continuous response.
Do not use phrases like "I fixed", "I updated", "tests passed", "I applied".
Use phrases like "Proposed fix:", "This should be changed to:", "Run this to verify:".

${chatCritiqueDirective}

${focusDirective}

PLANS TO PROCESS:
${planList}${agentHistoryDirective}`;
    }

    if (role === 'lead') {
        let leadPrompt = `Please execute the following ${plans.length} plans.

${executionDirective}

${batchExecutionRules}${challengeBlock}

${focusDirective}

PLANS TO PROCESS:
${planList}

COMPLETION PROTOCOL: When finished, you MUST paste the exact terminal output of your validation commands as proof. Then output exactly one of:
- IMPLEMENTATION COMPLETE — All plans implemented and verified. Send card to Reviewer.
- IMPLEMENTATION BLOCKED — reason: [reason]. Send card back to [PLANNER|CODER].${agentHistoryDirective}`;
        if (pairProgrammingEnabled) {
            leadPrompt += `\n\nNote: A Coder agent is concurrently handling the Routine tasks for these plans. You only need to do Complex (Band B) work. IMPORTANT: The Coder has JUST started and will NOT be finished yet — do NOT attempt to check or read their work at the start. Begin your Complex implementation immediately. Only check and integrate the Coder's Routine work as a final step before declaring completion, by which time they will have finished.`;
            if (aggressivePairProgramming) {
                leadPrompt += ` Routine scope has been expanded in aggressive pair programming mode. During your final integration check, pay extra attention to any Routine changes that touch files you also modified.`;
            }
        }
        return leadPrompt;
    }

    if (role === 'coder') {
        const intro = baseInstruction === 'low-complexity'
            ? `Please execute the following ${plans.length} low-complexity plans from PLAN REVIEWED.`
            : `Please execute the following ${plans.length} plans.`;
        let coderPrompt = withCoderAccuracyInstruction(`${intro}

${executionDirective}

${batchExecutionRules}${challengeBlock}

${focusDirective}

PLANS TO PROCESS:
${planList}

COMPLETION PROTOCOL: When finished, you MUST paste the exact terminal output of your validation commands as proof. Then output exactly one of:
- IMPLEMENTATION COMPLETE — All plans implemented and verified. Send card to Reviewer.
- IMPLEMENTATION BLOCKED — reason: [reason]. Send card back to Planner.${agentHistoryDirective}`, accurateCodingEnabled);
        if (pairProgrammingEnabled) {
            coderPrompt += `\n\nAdditional Instructions: only do Routine (Band A) work.`;
        }
        return coderPrompt;
    }

    return `Please process the following ${plans.length} plans.

${batchExecutionRules}

${focusDirective}

PLANS TO PROCESS:
${planList}

COMPLETION PROTOCOL: When finished executing the plans, you MUST update the plan files with your findings.
${agentHistoryDirective}`;
}

/**
 * Map a kanban column to the agent role that should PROCESS plans from it.
 * This is the autoban-compatible mapping used for all prompt generation.
 */
export function columnToPromptRole(column: string): string | null {
    const normalized = column === 'CODED' ? 'LEAD CODED' : column;
    switch (normalized) {
        case 'CREATED': return 'planner';
        case 'PLAN REVIEWED': return 'lead';
        case 'LEAD CODED':
        case 'CODER CODED':
            return 'reviewer';
        default:
            return column.startsWith('custom_agent_') ? column : null;
    }
}
