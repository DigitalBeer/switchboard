# Handoff Mode

## Goal
Add a handoff mode toggle switch to the kanban board header that, when activated, modifies prompt generation to split work by complexity bands (Band A vs Band B) similar to the handoff-relay workflow. Lead Coder receives Band B (complex) work only, Coder receives Band A (routine) work only. This mode must integrate seamlessly with all kanban dispatch paths: advance buttons, prompt buttons, autoban, and manual drag-and-drop.

## User Review Required
> [!NOTE]
> - **UI Change**: A new toggle switch will appear in the kanban header next to the CLI triggers toggle
> - **Behavior Change**: When handoff mode is enabled, prompts will include scope-limiting instructions ("only do band b work" or "only do band a")
> - **State Persistence**: Handoff mode state will be stored in `.switchboard/state.json` per workspace
> - **No Breaking Changes**: Existing workflows remain unaffected when handoff mode is disabled (default state)

## Complexity Audit
### Band A — Routine
- Add boolean flag `handoffModeEnabled` to `AutobanConfigState` type in `autobanState.ts`
- Add UI toggle element to kanban.html header controls strip
- Add message handler case `toggleHandoffMode` in KanbanProvider message switch
- Update webview postMessage to broadcast handoff mode state to UI
- Persist handoff mode state to `.switchboard/state.json` via existing state management
- Read handoff mode state during KanbanProvider initialization

### Band B — Complex / Risky
- Modify `buildKanbanBatchPrompt()` in `agentPromptBuilder.ts` to accept `handoffModeEnabled` parameter and conditionally append scope-limiting instructions based on role
- Thread handoff mode state through all prompt generation call sites:
  - `_generateBatchExecutionPrompt()` in KanbanProvider
  - `_generatePromptForColumn()` in KanbanProvider
  - TaskViewerProvider batch trigger methods
  - Autoban dispatch logic in TaskViewerProvider
- Handle complexity-based routing edge case: when handoff mode is enabled and a plan is routed from PLAN REVIEWED, ensure Lead gets Band B instruction and Coder gets Band A instruction regardless of which executes first
- Ensure prompt instruction text matches handoff-relay workflow exactly: "only do band b work" for lead, "only do band a" for coder
- Race condition risk: handoff mode toggle during active autoban dispatch could cause inconsistent prompts within a batch

## Edge-Case & Dependency Audit
- **Race Conditions**: Toggling handoff mode while autoban is dispatching a batch could result in some plans getting handoff instructions and others not. Mitigation: read handoff mode state once at batch start and use that snapshot for the entire batch.
- **Security**: No security implications—this is a UI preference flag that modifies prompt text only.
- **Side Effects**: 
  - Prompt text changes will affect all dispatch paths (advance, prompt buttons, autoban, drag-drop)
  - Plans dispatched with handoff mode enabled will have scope-limiting instructions in their terminal prompts
  - No impact on plan files themselves—only affects runtime prompts
- **Dependencies & Conflicts**: 
  - No conflicts detected with other pending Kanban plans
  - Depends on existing `AutobanConfigState` infrastructure for state persistence
  - Depends on existing `buildKanbanBatchPrompt()` prompt builder for instruction injection
  - Must coordinate with TaskViewerProvider's batch dispatch logic to ensure consistent handoff mode application

## Adversarial Synthesis
### Grumpy Critique
🔥 **GRUMPY PRINCIPAL ENGINEER REVIEW** 🔥

"Oh, WONDERFUL. Another toggle switch. Because what this codebase really needs is MORE state to track across six different dispatch paths. Let me guess—you're going to thread this boolean through every single prompt generation call site like a game of telephone, and when someone adds a seventh dispatch path in three months, they'll forget to check handoff mode and we'll have a silent bug where half the agents ignore the toggle.

And what happens when a user enables handoff mode, dispatches 10 plans to autoban, then DISABLES handoff mode 5 seconds later while the batch is still processing? Do plans 1-5 get handoff instructions and 6-10 don't? That's a consistency nightmare.

The 'only do band a' instruction is VAGUE. What if a plan has no Band A section? What if Band B is empty and marked '- None'? Does the coder just sit there twiddling their thumbs? And you're appending this as a string suffix to the prompt—no structured metadata, no validation, just raw text concatenation. Classic.

Also, I see you're storing this in `state.json` alongside autoban config. Great. Now we have YET ANOTHER field in that ever-growing JSON blob. When was the last time anyone audited what's actually IN that file? Probably never.

And the UI—oh, the UI. You're adding a toggle 'next to the CLI triggers toggle.' Where exactly? The header is already cramped. Are you going to label it 'Handoff Mode'? That means nothing to a new user. 'Band Split Mode'? 'Relay Mode'? Pick a name that doesn't require reading a 40-page manual to understand.

Finally, the complexity routing edge case: 'ensure Lead gets Band B instruction and Coder gets Band A instruction regardless of which executes first.' HOW? You're partitioning by complexity route, which means you don't know which role gets which plan until AFTER you read the plan file. If handoff mode is enabled, you need to inject role-specific instructions AFTER the partition, which means you need to pass handoff mode state into `_partitionByComplexityRoute()` or handle it downstream. Your plan doesn't specify which.

This is a 'simple' feature that touches 8+ files and introduces subtle state synchronization bugs. Ship it and watch the bug reports roll in."

### Balanced Response
The Grumpy critique raises valid concerns that must be addressed:

1. **State Consistency**: To prevent mid-batch toggle issues, we'll snapshot handoff mode state at the start of each batch operation (autoban tick, advance-all, prompt-all) and use that snapshot for the entire batch. This is the same pattern used for autoban config snapshots.

2. **Instruction Clarity**: The instruction text "only do band b work" and "only do band a" matches the existing handoff-relay workflow verbatim (see `TaskViewerProvider.ts` lines 7160, 7168, 7179). This is intentional for consistency. Agents are already trained to interpret these instructions.

3. **Empty Band Handling**: If a plan has no Band A or Band B content, the agent will interpret the scope instruction as "nothing to do in this scope" and report completion. This is acceptable behavior—it's the user's responsibility to ensure plans are properly structured before enabling handoff mode.

4. **State Management**: Adding `handoffModeEnabled` to `AutobanConfigState` leverages existing normalization, persistence, and broadcast infrastructure. This is the correct architectural choice—it keeps all kanban-related toggles in one place.

5. **UI Placement**: The toggle will be placed in the `.settings-strip` section (line 98-106 of kanban.html), which already contains the CLI triggers toggle and autoban controls. Label will be "Handoff Mode" with a tooltip explaining "Split work by complexity: Lead does Band B, Coder does Band A."

6. **Complexity Routing**: The handoff mode instruction will be injected in `buildKanbanBatchPrompt()` based on the `role` parameter. When `_partitionByComplexityRoute()` splits plans into lead/coder groups, each group's prompt is built separately with the correct role, so handoff mode instructions will automatically align (lead → Band B, coder → Band A).

7. **Call Site Threading**: Yes, this requires threading handoff mode state through multiple call sites. However, the implementation steps below use a consistent pattern: read state once, pass to `buildKanbanBatchPrompt()` via options parameter. This is maintainable and follows existing patterns (e.g., `accurateCodingEnabled`).

The implementation below addresses these concerns with explicit state snapshotting, consistent instruction injection, and clear UI labeling.

## Proposed Changes
> [!IMPORTANT]
> **MAXIMUM DETAIL REQUIRED:** All code blocks below are complete and ready to implement. No placeholders, no truncation.

### 1. State Type Definition
#### MODIFY `c:\Users\patvu\Documents\GitHub\switchboard\src\services\autobanState.ts`
- **Context**: The `AutobanConfigState` type is the canonical source for all kanban-related toggle states. Adding handoff mode here ensures it's persisted, normalized, and broadcast alongside autoban config.
- **Logic**: 
  1. Add `handoffModeEnabled: boolean` field to `AutobanConfigState` type
  2. Update `normalizeAutobanConfigState()` to default `handoffModeEnabled` to `false` if not present
  3. No changes needed to `buildAutobanBroadcastState()`—it already spreads the full state
- **Implementation**:

```typescript
export type AutobanConfigState = {
    enabled: boolean;
    batchSize: number;
    complexityFilter: AutobanComplexityFilter;
    routingMode: AutobanRoutingMode;
    maxSendsPerTerminal: number;
    globalSessionCap: number;
    sessionSendCount: number;
    sendCounts: Record<string, number>;
    terminalPools: Record<string, string[]>;
    managedTerminalPools: Record<string, string[]>;
    poolCursor: Record<string, number>;
    rules: Record<string, AutobanRuleState>;
    lastTickAt?: Record<string, number>;
    handoffModeEnabled: boolean;
};
```

And update the normalization function:

```typescript
export function normalizeAutobanConfigState(state?: Partial<AutobanConfigState> | null): AutobanConfigState {
    const rawRules = state?.rules ?? {};
    const legacyCodedRule = rawRules['CODED'];
    const mergedRules = {
        ...DEFAULT_AUTOBAN_RULES,
        ...rawRules,
        'LEAD CODED': rawRules['LEAD CODED'] ?? legacyCodedRule ?? DEFAULT_AUTOBAN_RULES['LEAD CODED'],
        'CODER CODED': rawRules['CODER CODED'] ?? legacyCodedRule ?? DEFAULT_AUTOBAN_RULES['CODER CODED']
    };
    const normalizedRules = Object.fromEntries(
        Object.entries(mergedRules)
            .filter(([column]) => column !== 'CODED')
            .map(([column, rule]) => {
                const fallback = DEFAULT_AUTOBAN_RULES[column] ?? { enabled: true, intervalMinutes: 10 };
                const intervalMinutes = normalizeFiniteCount(rule?.intervalMinutes, fallback.intervalMinutes, 1);
                return [column, {
                    enabled: typeof rule?.enabled === 'boolean' ? rule.enabled : fallback.enabled,
                    intervalMinutes
                }];
            })
    );

    const normalizedTerminalPools = normalizeStringArrayRecord(state?.terminalPools);
    const normalizedManagedTerminalPools = normalizeStringArrayRecord(state?.managedTerminalPools);
    const normalizedPoolCursor = normalizeCountRecord(state?.poolCursor);

    return {
        enabled: state?.enabled === true,
        batchSize: normalizeAutobanBatchSize(state?.batchSize),
        complexityFilter: state?.complexityFilter === 'low_only' || state?.complexityFilter === 'high_only'
            ? state.complexityFilter
            : 'all',
        routingMode: state?.routingMode === 'all_coder' || state?.routingMode === 'all_lead'
            ? state.routingMode
            : 'dynamic',
        maxSendsPerTerminal: normalizeFiniteCount(
            state?.maxSendsPerTerminal,
            DEFAULT_AUTOBAN_MAX_SENDS_PER_TERMINAL,
            1,
            100
        ),
        globalSessionCap: normalizeFiniteCount(
            typeof state?.globalSessionCap === 'number' && Number.isFinite(state.globalSessionCap) && state.globalSessionCap >= 1
                ? state.globalSessionCap
                : DEFAULT_AUTOBAN_GLOBAL_SESSION_CAP,
            DEFAULT_AUTOBAN_GLOBAL_SESSION_CAP,
            1
        ),
        sessionSendCount: normalizeFiniteCount(state?.sessionSendCount, 0, 0),
        sendCounts: normalizeCountRecord(state?.sendCounts),
        terminalPools: normalizedTerminalPools,
        managedTerminalPools: normalizedManagedTerminalPools,
        poolCursor: normalizedPoolCursor,
        rules: normalizedRules,
        lastTickAt: state?.lastTickAt ? { ...state.lastTickAt } : undefined,
        handoffModeEnabled: state?.handoffModeEnabled === true
    };
}
```

- **Edge Cases Handled**: Default to `false` ensures backward compatibility with existing state.json files that lack this field.

### 2. Prompt Builder Enhancement
#### MODIFY `c:\Users\patvu\Documents\GitHub\switchboard\src\services\agentPromptBuilder.ts`
- **Context**: `buildKanbanBatchPrompt()` is the single source of truth for all kanban prompt generation. Adding handoff mode support here ensures consistent instruction injection across all dispatch paths.
- **Logic**:
  1. Add `handoffModeEnabled?: boolean` to `PromptBuilderOptions` interface
  2. When `handoffModeEnabled` is true and role is 'lead', append "\n\nAdditional Instructions: only do band b work."
  3. When `handoffModeEnabled` is true and role is 'coder', append "\n\nAdditional Instructions: only do band a."
  4. No modification for 'planner' or 'reviewer' roles—handoff mode only affects execution roles
- **Implementation**:

```typescript
export interface PromptBuilderOptions {
    /** Base instruction hint (e.g. 'enhance', 'low-complexity', 'implement-all'). */
    instruction?: string;
    /** Whether to include an inline adversarial challenge block (lead role). */
    includeInlineChallenge?: boolean;
    /** Whether accuracy-mode workflow hint is appended (coder role). */
    accurateCodingEnabled?: boolean;
    /** Whether handoff mode is enabled (splits work by Band A/B). */
    handoffModeEnabled?: boolean;
}
```

And update the prompt builder function (showing only the modified sections for lead and coder roles):

```typescript
export function buildKanbanBatchPrompt(
    role: string,
    plans: BatchPromptPlan[],
    options?: PromptBuilderOptions
): string {
    const baseInstruction = options?.instruction;
    const includeInlineChallenge = options?.includeInlineChallenge ?? false;
    const accurateCodingEnabled = options?.accurateCodingEnabled ?? false;
    const handoffModeEnabled = options?.handoffModeEnabled ?? false;

    const focusDirective = `FOCUS DIRECTIVE: Each plan file path below is the single source of truth for that plan. Ignore any complexity regarding directory mirroring, 'brain' vs 'source' directories, or path hashing.`;
    const batchExecutionRules = `If your platform supports parallel sub-agents, dispatch one sub-agent per plan to execute them concurrently. If not, process them sequentially.

CRITICAL INSTRUCTIONS:
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

    if (role === 'planner') {
        const plannerVerb = baseInstruction === 'enhance' ? 'enhance' : 'improve';
        return `Please ${plannerVerb} the following ${plans.length} plans. Break each down into distinct steps grouped by high complexity and low complexity. Add extra detail.
MANDATORY: You MUST read and strictly adhere to \`.agent/rules/how_to_plan.md\` to format your output and ensure sufficient technical detail. Do not make assumptions about which files need to be changed; provide exact file paths and explicit implementation steps as required by the guide.
Do not add net-new product requirements or scope.
You may add clarifying implementation detail only if strictly implied by existing requirements; label it as "Clarification", not a new requirement.

${batchExecutionRules}

For each plan:
1. Read the plan file before editing.
2. Fill out 'TODO' sections or underspecified parts. Scan the Kanban board/plans folder for potential cross-plan conflicts and document them.
3. Ensure the plan has a "## Complexity Audit" section with "### Band A — Routine" and "### Band B — Complex / Risky" subsections. If missing, create it. If present, update it. If Band B is empty, write "- None" explicitly.
4. Perform adversarial review: post a Grumpy critique (dramatic "Grumpy Principal Engineer" voice: incisive, specific, theatrical) then a Balanced synthesis.
5. Update the original plan with the enhancement findings. Do NOT truncate, summarize, or delete existing implementation steps, code blocks, or goal statements.
6. Recommend agent: if the plan is simple (routine changes, only Band A), say "Send to Coder". If complex (Band B tasks, new frameworks), say "Send to Lead Coder".

${focusDirective}

PLANS TO PROCESS:
${planList}`;
    }

    if (role === 'reviewer') {
        const planTarget = plans.length <= 1 ? 'this plan' : 'each listed plan';
        const reviewerExecutionIntro = buildReviewerExecutionIntro(plans.length);
        const reviewerExecutionMode = buildReviewerExecutionModeLine(`For ${planTarget}, assess the actual code changes against the plan requirements, fix valid material issues in code when needed, then verify.`);
        return `${reviewerExecutionIntro}

${batchExecutionRules}

${reviewerExecutionMode}

For each plan:
1. Use the plan file as the source of truth for the review criteria.
2. Stage 1 (Grumpy): adversarial findings, severity-tagged (CRITICAL/MAJOR/NIT), in a dramatic "Grumpy Principal Engineer" voice (incisive, specific, theatrical).
3. Stage 2 (Balanced): synthesize Stage 1 into actionable fixes — what to keep, what to fix now, what can defer.
4. Apply code fixes for valid CRITICAL/MAJOR findings.
5. Run verification checks (typecheck/tests as applicable) and include results.
6. Update the original plan file with fixed items, files changed, validation results, and remaining risks. Do NOT truncate, summarize, or delete existing implementation steps.

CRITICAL: Do not stop after Stage 1. Complete the Grumpy review, the Balanced synthesis, the code fixes, and the plan update all in one continuous response.

${focusDirective}

PLANS TO PROCESS:
${planList}`;
    }

    if (role === 'lead') {
        const basePrompt = `Please execute the following ${plans.length} plans.

${batchExecutionRules}${challengeBlock}

${focusDirective}

PLANS TO PROCESS:
${planList}`;
        return handoffModeEnabled ? `${basePrompt}\n\nAdditional Instructions: only do band b work.` : basePrompt;
    }

    if (role === 'coder') {
        const intro = baseInstruction === 'low-complexity'
            ? `Please execute the following ${plans.length} low-complexity plans from PLAN REVIEWED.`
            : `Please execute the following ${plans.length} plans.`;
        const basePrompt = `${intro}

${batchExecutionRules}${challengeBlock}

${focusDirective}

PLANS TO PROCESS:
${planList}`;
        const withAccuracy = withCoderAccuracyInstruction(basePrompt, accurateCodingEnabled);
        return handoffModeEnabled ? `${withAccuracy}\n\nAdditional Instructions: only do band a.` : withAccuracy;
    }

    return `Please process the following ${plans.length} plans.

${batchExecutionRules}

${focusDirective}

PLANS TO PROCESS:
${planList}`;
}
```

- **Edge Cases Handled**: 
  - Handoff instructions only apply to 'lead' and 'coder' roles
  - Instructions are appended after accuracy mode instructions for coder (preserves existing instruction layering)
  - Default to `false` if option not provided (backward compatible)

### 3. KanbanProvider State Management
#### MODIFY `c:\Users\patvu\Documents\GitHub\switchboard\src\services\KanbanProvider.ts`
- **Context**: KanbanProvider manages the kanban webview and coordinates all dispatch operations. It must read, store, and broadcast handoff mode state.
- **Logic**:
  1. Read handoff mode from `_autobanState` (which is populated from state.json)
  2. Add message handler for `toggleHandoffMode` webview message
  3. Update `_generateBatchExecutionPrompt()` to pass handoff mode to `buildKanbanBatchPrompt()`
  4. Update `_generatePromptForColumn()` to pass handoff mode for lead/coder roles
  5. Broadcast handoff mode state to webview alongside autoban config
- **Implementation**:

Add the message handler in the `_handleMessage()` switch statement (after line 1045):

```typescript
case 'toggleHandoffMode': {
    const enabled = !!msg.enabled;
    if (this._autobanState) {
        this._autobanState = { ...this._autobanState, handoffModeEnabled: enabled };
    }
    await vscode.commands.executeCommand('switchboard.setHandoffModeFromKanban', enabled);
    break;
}
```

Update `_generateBatchExecutionPrompt()` method (around line 419):

```typescript
private _generateBatchExecutionPrompt(cards: KanbanCard[], workspaceRoot: string): string {
    const hasHighComplexity = cards.some(card => !this._isLowComplexity(card));
    const role = hasHighComplexity ? 'lead' : 'coder';
    const instruction = hasHighComplexity ? undefined : 'low-complexity';
    const accurateCodingEnabled = vscode.workspace.getConfiguration('switchboard').get<boolean>('accurateCoding.enabled', true);
    const handoffModeEnabled = this._autobanState?.handoffModeEnabled ?? false;
    return buildKanbanBatchPrompt(role, this._cardsToPromptPlans(cards, workspaceRoot), {
        instruction,
        accurateCodingEnabled,
        handoffModeEnabled
    });
}
```

Update `_generatePromptForColumn()` method (around line 458):

```typescript
private _generatePromptForColumn(cards: KanbanCard[], column: string, workspaceRoot: string): string {
    const handoffModeEnabled = this._autobanState?.handoffModeEnabled ?? false;
    
    if (column === 'PLAN REVIEWED') {
        return this._generateBatchExecutionPrompt(cards, workspaceRoot);
    }
    
    const role = columnToPromptRole(column);
    if (role === 'planner') {
        return this._generateBatchPlannerPrompt(cards, workspaceRoot);
    }
    if (role === 'reviewer') {
        return buildKanbanBatchPrompt('reviewer', this._cardsToPromptPlans(cards, workspaceRoot));
    }
    return buildKanbanBatchPrompt(
        role || 'lead',
        this._cardsToPromptPlans(cards, workspaceRoot),
        { handoffModeEnabled }
    );
}
```

- **Edge Cases Handled**: 
  - Default to `false` if `_autobanState` is undefined or doesn't have the field
  - State updates trigger VS Code command to persist to state.json (same pattern as autoban toggle)

### 4. Extension Command Registration
#### MODIFY `c:\Users\patvu\Documents\GitHub\switchboard\src\extension.ts`
- **Context**: VS Code commands bridge webview messages to TaskViewerProvider state persistence.
- **Logic**: Register `switchboard.setHandoffModeFromKanban` command that delegates to TaskViewerProvider
- **Implementation**:

Add after the autoban command registration (around line 876):

```typescript
const setHandoffModeFromKanbanDisposable = vscode.commands.registerCommand('switchboard.setHandoffModeFromKanban', async (enabled: boolean) => {
    await taskViewerProvider.setHandoffModeEnabled(enabled);
});
context.subscriptions.push(setHandoffModeFromKanbanDisposable);
```

- **Edge Cases Handled**: Command follows existing pattern for `setAutobanEnabledFromKanban`

### 5. TaskViewerProvider State Persistence
#### MODIFY `c:\Users\patvu\Documents\GitHub\switchboard\src\services\TaskViewerProvider.ts`
- **Context**: TaskViewerProvider manages `.switchboard/state.json` persistence and coordinates autoban state. It must persist handoff mode and pass it to batch dispatch operations.
- **Logic**:
  1. Add `setHandoffModeEnabled()` method to update state.json
  2. Update batch dispatch methods to read handoff mode from autoban state and pass to `buildKanbanBatchPrompt()`
  3. Ensure autoban tick operations snapshot handoff mode at batch start
- **Implementation**:

Add the state setter method (after `setAutobanEnabled()` around line 2500):

```typescript
public async setHandoffModeEnabled(enabled: boolean): Promise<void> {
    const workspaceRoot = this._resolveWorkspaceRoot();
    if (!workspaceRoot) { return; }
    
    const statePath = path.join(workspaceRoot, '.switchboard', 'state.json');
    try {
        let state: any = {};
        if (fs.existsSync(statePath)) {
            state = JSON.parse(await fs.promises.readFile(statePath, 'utf8'));
        }
        if (!state.autobanConfig) {
            state.autobanConfig = {};
        }
        state.autobanConfig.handoffModeEnabled = enabled;
        await fs.promises.writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');
        
        const normalizedConfig = normalizeAutobanConfigState(state.autobanConfig);
        this._kanbanProvider?.updateAutobanConfig(normalizedConfig);
        
        vscode.window.showInformationMessage(`Handoff mode ${enabled ? 'enabled' : 'disabled'}.`);
    } catch (e) {
        console.error('[TaskViewerProvider] Failed to update handoff mode:', e);
        vscode.window.showErrorMessage('Failed to update handoff mode.');
    }
}
```

Update `handleKanbanBatchTrigger()` to pass handoff mode (around line 5700):

```typescript
const handoffModeEnabled = this._autobanState?.handoffModeEnabled ?? false;
const prompt = buildKanbanBatchPrompt(role, plans, {
    instruction,
    accurateCodingEnabled: this._isAccurateCodingEnabled(),
    handoffModeEnabled
});
```

Update autoban dispatch logic in `_dispatchAutobanBatch()` to snapshot handoff mode (around line 6800):

```typescript
const handoffModeSnapshot = this._autobanState?.handoffModeEnabled ?? false;
// ... later when building prompts:
const prompt = buildKanbanBatchPrompt(role, plans, {
    accurateCodingEnabled: this._isAccurateCodingEnabled(),
    handoffModeEnabled: handoffModeSnapshot
});
```

- **Edge Cases Handled**:
  - Snapshot handoff mode at batch start prevents mid-batch toggle inconsistencies
  - Default to `false` if state is undefined
  - State.json creation handled if file doesn't exist

### 6. Kanban UI Toggle
#### MODIFY `c:\Users\patvu\Documents\GitHub\switchboard\src\webview\kanban.html`
- **Context**: The kanban webview UI needs a toggle switch in the settings strip to control handoff mode.
- **Logic**:
  1. Add checkbox toggle element in `.settings-strip` section
  2. Add JavaScript message handler to receive handoff mode state from extension
  3. Add click handler to send `toggleHandoffMode` message to extension
  4. Style toggle to match existing CLI triggers toggle
- **Implementation**:

Add the toggle HTML in the `.settings-strip` section (after the CLI triggers toggle, around line 350 in the HTML body):

```html
<label class="cli-toggle handoff-toggle" title="Split work by complexity: Lead does Band B, Coder does Band A">
    <input type="checkbox" id="handoffModeCheckbox">
    <span class="toggle-label">Handoff Mode</span>
</label>
```

Add JavaScript message handler in the `window.addEventListener('message', ...)` section:

```javascript
case 'updateHandoffMode':
    const handoffCheckbox = document.getElementById('handoffModeCheckbox');
    if (handoffCheckbox) {
        handoffCheckbox.checked = event.data.enabled;
        const handoffToggle = handoffCheckbox.closest('.handoff-toggle');
        if (handoffToggle) {
            handoffToggle.classList.toggle('is-off', !event.data.enabled);
        }
    }
    break;
```

Add click handler in the initialization section:

```javascript
const handoffModeCheckbox = document.getElementById('handoffModeCheckbox');
if (handoffModeCheckbox) {
    handoffModeCheckbox.addEventListener('change', (e) => {
        const enabled = e.target.checked;
        vscode.postMessage({ type: 'toggleHandoffMode', enabled });
    });
}
```

- **Edge Cases Handled**:
  - Tooltip explains what handoff mode does
  - Toggle state syncs with extension state via message passing
  - CSS classes reuse existing `.cli-toggle` styles for consistency

### 7. Broadcast Handoff Mode to Webview
#### MODIFY `c:\Users\patvu\Documents\GitHub\switchboard\src\services\KanbanProvider.ts`
- **Context**: When autoban config is broadcast to the webview, handoff mode state must be included.
- **Logic**: Add a separate `updateHandoffMode` message post alongside `updateAutobanConfig`
- **Implementation**:

In `updateAutobanConfig()` method (around line 720), add:

```typescript
public updateAutobanConfig(state: AutobanConfigState): void {
    this._autobanState = state;
    if (!this._panel) { return; }
    this._panel.webview.postMessage({ type: 'updateAutobanConfig', state });
    this._panel.webview.postMessage({ type: 'updateHandoffMode', enabled: state.handoffModeEnabled });
}
```

In `_refreshBoardImpl()` method (around line 372), add:

```typescript
if (this._autobanState) {
    this._panel.webview.postMessage({ type: 'updateAutobanConfig', state: this._autobanState });
    this._panel.webview.postMessage({ type: 'updateHandoffMode', enabled: this._autobanState.handoffModeEnabled });
}
```

- **Edge Cases Handled**: Handoff mode state is broadcast on every config update and board refresh, ensuring UI stays in sync

## Verification Plan
### Automated Tests
- **Unit Test**: `agentPromptBuilder.test.ts` — verify `buildKanbanBatchPrompt()` appends correct handoff instructions for lead/coder roles when `handoffModeEnabled: true`
- **Unit Test**: `autobanState.test.ts` — verify `normalizeAutobanConfigState()` defaults `handoffModeEnabled` to `false` and preserves explicit values
- **Integration Test**: Verify handoff mode toggle in kanban UI updates state.json and persists across VS Code restarts

### Manual Tests
1. **Toggle Persistence**:
   - Open kanban board
   - Enable handoff mode toggle
   - Verify `.switchboard/state.json` contains `"handoffModeEnabled": true` in `autobanConfig`
   - Reload VS Code window
   - Verify handoff mode toggle remains checked

2. **Prompt Button Test**:
   - Create 2 plans in PLAN REVIEWED (1 high complexity, 1 low complexity)
   - Enable handoff mode
   - Click "Prompt Selected" on the high-complexity plan
   - Verify clipboard contains "Additional Instructions: only do band b work."
   - Click "Prompt Selected" on the low-complexity plan
   - Verify clipboard contains "Additional Instructions: only do band a."

3. **Advance Button Test**:
   - Create 1 plan in PLAN REVIEWED (high complexity)
   - Enable handoff mode
   - Click "Advance Selected" button
   - Verify lead coder terminal receives prompt with "only do band b work"

4. **Autoban Test**:
   - Enable autoban for PLAN REVIEWED column
   - Enable handoff mode
   - Create 3 plans in PLAN REVIEWED (mixed complexity)
   - Wait for autoban tick
   - Verify lead coder terminals receive "only do band b work"
   - Verify coder terminals receive "only do band a"

5. **Drag-Drop Test**:
   - Create 1 plan in PLAN REVIEWED (low complexity)
   - Enable handoff mode
   - Drag plan to CODER CODED column
   - Verify coder terminal receives prompt with "only do band a"

6. **Mid-Batch Toggle Test** (edge case):
   - Create 5 plans in PLAN REVIEWED
   - Enable handoff mode
   - Click "Advance All" button
   - Immediately disable handoff mode while batch is processing
   - Verify all 5 plans receive consistent handoff instructions (all have or all lack)

7. **Disable Mode Test**:
   - Disable handoff mode
   - Advance a plan from PLAN REVIEWED
   - Verify prompt does NOT contain "Additional Instructions" suffix

### Verification Commands
```bash
# Check state.json for handoff mode field
cat .switchboard/state.json | grep handoffModeEnabled

# Verify TypeScript compilation
npm run compile

# Run unit tests (if test suite exists)
npm test
```

## Recommendation
**Send to Lead Coder**

This plan contains Band B complexity:
- Modifying the shared prompt builder to conditionally inject instructions based on role and mode state
- Threading handoff mode state through multiple dispatch paths (KanbanProvider, TaskViewerProvider, autoban logic)
- Handling state consistency during concurrent batch operations (snapshot pattern)
- UI/webview message passing and state synchronization

While individual file changes are straightforward, the cross-cutting nature of the feature (touches 6 files, 3 subsystems) and the need to ensure consistent behavior across 4 dispatch paths (advance, prompt, autoban, drag-drop) requires careful integration testing and architectural awareness.
