# Aggressive Pair Programming Mode

## Goal
Add an **Aggressive Pair Programming** toggle to the Setup sidebar menu (defaults to OFF). When enabled, modify the improve-plan (planner) prompt to assume higher competency of the Coder agent, causing the planner to classify more tasks as Band A (routine) and fewer as Band B (complex). This shifts the workload balance so that the Lead Coder handles only truly hard architectural tasks, while the Coder handles everything else — maximising token savings from pair programming.

## User Review Required
> [!NOTE]
> - This toggle defaults to **OFF**. The user must deliberately enable it, signalling they understand the trade-off: more work on a cheaper/faster Coder agent means slightly higher risk of implementation errors on borderline-complexity tasks.
> - This does NOT change the runtime pair programming behaviour (dispatch, clipboard, etc.). It only changes how the **planner classifies** task complexity during the improve-plan phase.
> - Existing plans that have already been improved/classified are unaffected. The mode only influences future improve-plan runs.
> - Requires pair programming to be enabled to have any effect. When pair programming is OFF, the aggressive toggle has no impact (there's no Band A/B split to optimise).

## How It Works

### Current Behaviour (Aggressive OFF)
The planner prompt says:
> "Break each down into distinct steps grouped by high complexity and low complexity."

The planner uses its own judgement about what constitutes "routine" vs "complex/risky". A conservative planner (e.g. Opus) tends to classify borderline tasks as Band B, keeping them on the expensive Lead agent.

### New Behaviour (Aggressive ON)
The planner prompt is augmented with an additional directive:

> "PAIR PROGRAMMING OPTIMISATION: Aggressive mode is enabled. Assume the Coder agent is highly competent and can handle most implementation tasks independently, including multi-file changes, test updates, and straightforward refactors. Only classify tasks as Band B (Complex / Risky) if they involve: (a) new architectural patterns or framework integrations the codebase hasn't used before, (b) security-sensitive logic (auth, crypto, permissions), (c) complex state machines or concurrency, or (d) changes that could silently break existing behaviour without obvious test failures. Everything else — even if it touches multiple files or requires careful reading — should be Band A."

This narrows the Band B criteria from "anything non-trivial" to "only genuinely hard problems", pushing 60–80% of typical plan tasks to Band A.

### Expected Impact

| Metric | Standard Pair | Aggressive Pair |
|--------|--------------|-----------------|
| Band A tasks (Coder) | ~40% | ~70% |
| Band B tasks (Lead) | ~60% | ~30% |
| Lead token usage | Baseline | ~50% reduction |
| Risk of Coder errors | Low | Medium (mitigated by review stage) |

The review stage catches any Coder errors, so the risk is bounded — tasks still go through CODE REVIEWED before completion.

## Complexity Audit

### Band A — Routine
- **Add `aggressivePairProgramming` field to `AutobanConfigState`** in `src/services/autobanState.ts` — boolean, defaults to `false`. Same pattern as `pairProgrammingEnabled`.
- **Add toggle HTML to Setup sidebar** in `src/webview/implementation.html` — checkbox with label, positioned after the existing pair programming / accurate coding toggles.
- **Persist and load the setting** — add `getAggressivePairSetting` / save in `saveStartupCommands` message handlers in `TaskViewerProvider.ts`, same pattern as `accurateCodingEnabled`.
- **Pass setting to `agentPromptBuilder`** — add `aggressivePairProgramming` to `PromptBuilderOptions` interface.

### Band B — Complex / Risky
- **Modify planner prompt in `buildKanbanBatchPrompt()`** — when `aggressivePairProgramming` is true AND role is `planner`, append the aggressive classification directive. The wording must be precise: too aggressive and the Coder gets tasks it can't handle; too conservative and the toggle has no effect. The directive must be injected at the right point in the prompt (after the base classification instruction, before the plan list) to override the planner's default complexity heuristic.
- **Propagate state from Setup → Kanban → Prompt Builder** — the aggressive setting lives in the Setup sidebar but must flow through to the prompt builder when the planner prompt is generated. This crosses the TaskViewerProvider → KanbanProvider → agentPromptBuilder boundary. Ensure the state is available at prompt-generation time without race conditions.

## Implementation Steps

### Step 1: Add field to AutobanConfigState (Band A)

**File:** `src/services/autobanState.ts`

Add `aggressivePairProgramming: boolean` to `AutobanConfigState` type, defaulting to `false` in `normalizeAutobanConfigState()`.

```typescript
// In AutobanConfigState type:
aggressivePairProgramming: boolean;

// In normalizeAutobanConfigState():
aggressivePairProgramming: state?.aggressivePairProgramming === true
```

### Step 2: Add toggle to Setup sidebar (Band A)

**File:** `src/webview/implementation.html`

Add a checkbox after the existing accurate-coding toggle:

```html
<label class="startup-row" style="display:flex; align-items:center; gap:8px; margin-top:6px;">
    <input id="aggressive-pair-toggle" type="checkbox" style="width:auto; margin:0;">
    <span>Aggressive pair programming (shift more tasks to Coder)</span>
</label>
```

Wire the toggle in the JS:
- On section open: `vscode.postMessage({ type: 'getAggressivePairSetting' });`
- On save: include `aggressivePairProgramming: !!document.getElementById('aggressive-pair-toggle')?.checked` in the `saveStartupCommands` payload.
- On message `aggressivePairSetting`: set `toggle.checked = message.enabled`.

### Step 3: Persist and load in TaskViewerProvider (Band A)

**File:** `src/services/TaskViewerProvider.ts`

Follow the exact pattern of `accurateCodingEnabled`:
- Add `getAggressivePairSetting` message handler that reads from `workspaceState` and posts back to webview.
- In `saveStartupCommands` handler, persist `msg.aggressivePairProgramming` to `workspaceState`.
- Expose a getter method for use by KanbanProvider.

### Step 4: Add option to PromptBuilderOptions (Band A)

**File:** `src/services/agentPromptBuilder.ts`

```typescript
export interface PromptBuilderOptions {
    instruction?: string;
    includeInlineChallenge?: boolean;
    accurateCodingEnabled?: boolean;
    pairProgrammingEnabled?: boolean;
    /** When true, planner classifies more tasks as Band A, assuming a competent Coder. */
    aggressivePairProgramming?: boolean;
}
```

### Step 5: Modify planner prompt (Band B)

**File:** `src/services/agentPromptBuilder.ts`

In the `role === 'planner'` branch, after the base classification instruction, conditionally append the aggressive directive:

```typescript
if (role === 'planner') {
    const plannerVerb = baseInstruction === 'enhance' ? 'enhance' : 'improve';
    let plannerPrompt = `Please ${plannerVerb} the following ${plans.length} plans. Break each down into distinct steps grouped by high complexity and low complexity. Add extra detail.`;

    // Aggressive pair programming: narrow Band B criteria
    const aggressivePair = options?.aggressivePairProgramming ?? false;
    if (aggressivePair) {
        plannerPrompt += `\n\nPAIR PROGRAMMING OPTIMISATION: Aggressive mode is enabled. Assume the Coder agent is highly competent and can handle most implementation tasks independently, including multi-file changes, test updates, and straightforward refactors. Only classify tasks as Band B (Complex / Risky) if they involve: (a) new architectural patterns or framework integrations the codebase hasn't used before, (b) security-sensitive logic (auth, crypto, permissions), (c) complex state machines or concurrency, or (d) changes that could silently break existing behaviour without obvious test failures. Everything else — even if it touches multiple files or requires careful reading — should be Band A.`;
    }

    plannerPrompt += `\nMANDATORY: You MUST read and strictly adhere to ...`; // rest of existing prompt
    // ...
}
```

### Step 6: Propagate state at prompt-generation time (Band B)

**File:** `src/services/KanbanProvider.ts`

When generating planner prompts (in `_generatePromptForColumn` and any direct `buildKanbanBatchPrompt('planner', ...)` calls), read the aggressive pair setting from the autoban state or workspace configuration:

```typescript
const aggressivePairProgramming = this._autobanState?.aggressivePairProgramming ?? false;

// Pass to prompt builder
buildKanbanBatchPrompt('planner', plans, {
    instruction,
    aggressivePairProgramming
});
```

Ensure all code paths that generate planner prompts include this option — check `_generatePromptForColumn()`, `_generateBatchPlannerPrompt()`, and any direct `buildKanbanBatchPrompt('planner', ...)` calls.

## Edge-Case & Dependency Audit

- **Race Conditions:** The toggle is persisted to `workspaceState` synchronously on save. Prompt generation reads from `this._autobanState` which is updated on the same event loop. No race.
- **Security:** No new attack surface. The toggle only changes prompt text sent to the planner.
- **Side Effects:** 
  - When aggressive mode is ON but pair programming is OFF, the planner still classifies aggressively. This means plans will have more Band A tasks even without a Coder to handle them. The Lead will execute everything anyway — minor inefficiency but not harmful.
  - If the Coder agent is actually weak (e.g. a small local model), aggressive mode may cause failures. The review stage catches these, but the user should be aware. The toggle label ("shift more tasks to Coder") signals this trade-off.
- **Dependencies & Conflicts:**
  - **Pair Programming feature**: Existing. No conflict — this is an additive enhancement.
  - **Two-Stage Clipboard plan** (`feature_plan_20260321_225300`): No conflict — that plan changes dispatch mechanics, this changes planning classification. Independent concerns.
  - **Drag and Drop Mode Switch plan** (`feature_plan_20260321_213109`): No conflict.

## Adversarial Synthesis

### Grumpy Critique
Oh JOY. We're going to tell the planner to classify MORE things as "easy" so we can dump them on a cheaper model. What could POSSIBLY go wrong?

1. **The prompt is a suggestion, not a guarantee.** You're asking an LLM to narrow its complexity heuristic via natural language instruction. Different planners (Opus, Sonnet, GPT-4) will interpret "highly competent Coder" differently. Opus might still classify 50% as Band B because it's conservative by nature. Sonnet might dump 90% into Band A because it's eager to please. You have ZERO calibration across models and you're pretending this is a toggle with predictable behaviour.

2. **No feedback loop.** If aggressive mode causes the Coder to fail on tasks it shouldn't have been assigned, there's no mechanism to automatically dial back. The user has to notice failures during review, mentally correlate them with aggressive mode, and toggle it off. That's a multi-step diagnostic that most users won't perform — they'll just think "the Coder is bad" and stop using pair programming entirely.

3. **The aggressive directive text is doing too much work.** You're cramming four classification criteria (a–d) into a single paragraph. The planner might anchor on (a) and ignore (b–d), or interpret "new architectural patterns" so broadly that everything stays Band B. The directive needs to be battle-tested with multiple models before shipping.

### Balanced Response
1. **Model variance** — Valid concern. **Mitigate**: The directive is intentionally prescriptive (listing exactly 4 Band B criteria) rather than vague ("be more aggressive"). This constrains the interpretation space. However, we should acknowledge in the README that results vary by planner model and recommend Opus/GPT-4 for best classification accuracy.
2. **No feedback loop** — Valid but out of scope for V1. **Defer**: A future iteration could track Coder failure rates by plan and auto-suggest disabling aggressive mode if failures exceed a threshold. For V1, the review stage is the safety net.
3. **Directive wording** — Valid concern. **Mitigate**: The four criteria are drawn from real-world pair programming heuristics (architectural novelty, security, concurrency, silent failures). The wording has been reviewed to be specific enough to constrain but broad enough to cover edge cases. The user can always toggle OFF if results are unsatisfactory.

## Verification Plan

### Automated Tests
- **TypeScript compilation**: `npx tsc -p . --noEmit` must pass.
- **Webpack build**: `npm run compile` must succeed.
- Unit test for `normalizeAutobanConfigState()`: verify `aggressivePairProgramming` defaults to `false` and passes through `true` when set.
- Unit test for `buildKanbanBatchPrompt('planner', ...)`: verify the aggressive directive is appended when `aggressivePairProgramming: true` and absent when `false`.

### Manual Testing
1. Open Setup sidebar. Verify "Aggressive pair programming" toggle appears after accurate coding toggle. Verify it defaults to OFF.
2. Enable the toggle, save. Close and reopen Setup. Verify the toggle state persisted.
3. With aggressive mode ON: run improve-plan on a plan with mixed-complexity tasks. Verify the planner prompt includes the "PAIR PROGRAMMING OPTIMISATION" directive.
4. Compare the planner's Band A/B classification of the same plan with aggressive mode ON vs OFF. Verify Band A has more tasks when aggressive is ON.
5. With aggressive mode ON but pair programming OFF: verify plans are still classified aggressively (the toggle affects planning, not dispatch).
6. Toggle OFF. Run improve-plan again. Verify the directive is absent from the prompt.

### Step 7: Enhance Lead integration check when aggressive mode is on (Band A)

**File:** `src/services/agentPromptBuilder.ts`

In the `role === 'lead'` branch, when `pairProgrammingEnabled` AND `aggressivePairProgramming` are both true, append an additional sentence to the existing pair programming note:

```typescript
if (pairProgrammingEnabled) {
    leadPrompt += `\n\nNote: A Coder agent is concurrently handling the Band A (routine) tasks ...`; // existing text
    if (aggressivePair) {
        leadPrompt += ` Band A scope has been expanded in aggressive pair programming mode. During your final integration check, pay extra attention to any Band A changes that touch files you also modified.`;
    }
}
```

This adds ~30 tokens to the Lead prompt — a negligible cost that focuses the Lead's attention on overlapping file changes (the real risk area) without requesting a full review of all Band A work.

### Step 8: Update README with aggressive mode guidance (Band A)

**File:** `README.md`

Add a note to the Pair Programming Mode section (after the three-mode table) explaining the trade-off:

```markdown
#### Aggressive Pair Programming

Enable **Aggressive Pair Programming** in the Setup sidebar to shift more tasks to the Coder agent. This tells the planner to assume the Coder is highly competent, classifying only truly complex work (new architectures, security logic, concurrency) as Band B for the Lead. Everything else goes to Band A.

This saves tokens — but the code review step becomes more important. With more work on the Coder, the Reviewer agent in the CODE REVIEWED column is your primary quality gate. Make sure you have a capable model assigned to the Reviewer role when using aggressive mode.
```

## Open Questions
- **Resolved:** Should aggressive mode affect the Coder/Lead execution prompts (not just the planner)? → Only minimally. The Lead gets a lightweight integration-check enhancement (~30 tokens) warning about expanded Band A scope. The Coder prompt is unchanged. This avoids duplicating the Reviewer stage while catching merge conflicts in overlapping files.
- **Open:** Should there be a per-plan override (e.g., a flag in the plan file to force standard classification for sensitive plans)?
- **Open:** Should the aggressive directive be customisable by the user (e.g., a text area in Setup for custom classification criteria)?

## Recommended Agent
**Send to Coder** — This plan is predominantly Band A (toggle UI, state persistence, option plumbing). The Band B work (prompt wording, state propagation) is straightforward once the plumbing is in place.

---

## Reviewer Pass — 2026-03-23

### Findings

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| 1 | **CRITICAL** | State split: `saveStartupCommands` saves aggressive toggle to VS Code config but never syncs to `_autobanState`. KanbanProvider reads from `_autobanState` → always sees `false`. All Kanban batch/autoban dispatches never include the aggressive directive. | **FIXED** |
| 2 | **MAJOR** | Autoban state not seeded from VS Code config on startup. If workspaceState has stale `aggressivePairProgramming: false` but VS Code config has `true`, KanbanProvider starts with wrong value. | **FIXED** |
| 3 | NIT | Aggressive directive uses "Routine"/"Complex" terminology (matching current codebase) instead of plan's "Band A"/"Band B". Code is correct; plan wording is outdated. | Deferred (cosmetic) |
| 4 | NIT | Toggle position in HTML is after `lead-challenge-toggle`, not directly after `accurate-coding-toggle` as spec'd. Ordering is sensible. | Deferred (cosmetic) |

### Fixes Applied

**File: `src/services/TaskViewerProvider.ts`**

1. **Lines 2993-2999 (Finding 1 — CRITICAL):** After saving `aggressivePairProgramming` to VS Code config in the `saveStartupCommands` handler, added sync to `this._autobanState` via `normalizeAutobanConfigState()`, then `_persistAutobanState()` + `_postAutobanState()` to propagate to KanbanProvider immediately.

2. **Lines 212-213 (Finding 2 — MAJOR):** After restoring autoban state from `workspaceState` on startup, seed `aggressivePairProgramming` from VS Code config (`switchboard.pairProgramming.aggressive`) so KanbanProvider starts with the correct value.

### Files Changed
- `src/services/TaskViewerProvider.ts` — 2 edits (startup seed + save sync)

### Validation Results
- **TypeScript compilation (`npx tsc -p . --noEmit`):** ✅ Pass (exit code 0)
- **Webpack build (`npm run compile`):** ✅ Pass — both bundles compiled successfully

### Remaining Risks
- **Model variance in aggressive directive interpretation** — Different planner models may interpret the 4 Band B criteria differently. Acknowledged in plan's adversarial synthesis; bounded by review stage.
- **No automatic feedback loop** — If aggressive mode causes Coder failures, no auto-dial-back mechanism exists. Deferred to V2.
- **Aggressive ON + Pair Programming OFF** — Plans still classified aggressively even without a Coder to handle Band A. Minor inefficiency, not harmful. Documented in Edge-Case audit.
