# Add 'Summarise All Plans' Command at End of Automated Review Session

## Goal
Enhance automated pipelines (Auto-Agent Orchestrator and Kanban auto-move) to recognize when the queue is fully drained. When the final plan in a batch is dispatched to a Reviewer, the system will immediately dispatch a second, standalone command instructing the Reviewer to summarize the batch and offer reversion options.

## User Review Required
> [!NOTE] 
> This relies on the native `stdin` buffering of the target CLI. The extension will send the summary command immediately after the final plan. The CLI will queue this text in the buffer and execute it naturally once the plan review completes.

## Complexity Audit
### Band A — Routine
- Updating `PipelineOrchestrator.ts` and `KanbanProvider.ts` to detect when the queue length is `1` and pass a new `isFinalInBatch` flag to the dispatch handlers.
- Modifying `switchboard.triggerAgentFromKanban` in `src/extension.ts` to accept the boolean flag.

### Band B — Complex / Risky
- Updating `TaskViewerProvider.ts` to trigger two sequential `_dispatchExecuteMessage` calls safely without violating the deduplication locks.

## Edge-Case Audit
*   **Race Conditions:** `_dispatchExecuteMessage` uses `sendRobustText`, which correctly `awaits` the pacing delays (currently 2000ms). Sending two back-to-back dispatches will safely execute synchronously, ensuring the terminal receives them in the correct sequential order.
*   **Security:** No new path execution or shell injection vectors introduced.
*   **Side Effects:** Sending a second independent message will generate a second `msg_*.json` file if the terminal is not local (cross-IDE routing). The `InboxWatcher` sorts by timestamp, so they will be consumed sequentially.

## Adversarial Synthesis
### Grumpy Critique
Wait, if you send a summary command *immediately* after the last plan is dispatched, how do you know the agent won't get confused by the queued messages? What if the agent's CLI tool doesn't handle back-to-back inputs properly and jumbles the tasks? Also, hardcoding `columnCards.length === 1` assumes no new cards get added during the transition. If a user drops a card in right as the timer fires, the batch state gets messed up!

### Balanced Response
Grumpy's point about CLI buffering is crucial. However, the Switchboard protocol already uses `paced: true` in `_dispatchExecuteMessage` which enforces a delay, allowing the terminal's stdin to buffer the commands cleanly. The agent processes one input at a time sequentially. Regarding the queue length, `columnCards` is evaluated at the exact moment the timer fires. If a user adds a card *after* the evaluation but before the dispatch, it will simply be processed in the next timer cycle, which is a safe failure mode. We will ensure the summary message is distinct and clear to avoid confusing the agent.

## Proposed Changes

### 1. The Dispatch Interface
#### [MODIFY] `src/extension.ts`
- **Context:** The command bridging the Kanban UI to the backend must support the new flag.
- **Logic:** Add `isFinalInBatch?: boolean` to `switchboard.triggerAgentFromKanban`.
- **Implementation:** `taskViewerProvider.handleKanbanTrigger(role, sessionId, instruction, isFinalInBatch);`

### 2. The Kanban Provider
#### [MODIFY] `src/services/KanbanProvider.ts`
- **Context:** The auto-move timer needs to detect the end of the column queue.
- **Logic:** In `_autoMoveOneCard`, evaluate if `columnCards.length === 1`.
- **Implementation:** Pass `columnCards.length === 1` as the `isFinalInBatch` argument to the trigger command.

### 3. The Pipeline Orchestrator
#### [MODIFY] `src/services/PipelineOrchestrator.ts`
- **Context:** The pipeline loop processes the active run sheets.
- **Logic:** Update the `DispatchCallback` signature to accept `isFinalInBatch?: boolean`. Inside `_advance()`, check `pending.length === 1`.
- **Implementation:** Pass `pending.length === 1` to the `_dispatchCallback`.

### 4. The Task Viewer Provider (Core Logic)
#### [MODIFY] `src/services/TaskViewerProvider.ts`
- **Context:** The core action handler must execute the double-dispatch when the condition is met.
- **Logic:** Update signatures to accept `isFinalInBatch`. After `await this._dispatchExecuteMessage(...)` succeeds for the plan, evaluate if `isFinalInBatch && role === 'reviewer'`. If true, construct the standalone summary request and `await this._dispatchExecuteMessage` again.
- **Implementation:** 
```typescript
if (isFinalInBatch && role === 'reviewer') {
    const summaryPayload = `BATCH COMPLETION NOTICE: The automated queue is now empty. Please provide a holistic summary of all changes made across the recent batch of plans. Ask the user to review these changes and explicitly offer to revert any regressions or unwanted modifications.`;
    await this._dispatchExecuteMessage(workspaceRoot, targetAgent, summaryPayload, {
        phase_gate: { enforce_persona: 'reviewer', bypass_workflow_triggers: 'true' },
        paced: true
    }, 'system');
}
```

## Verification Plan
### Automated Tests
- Run `npm run compile` to verify all TypeScript interfaces compile cleanly across the newly updated command signatures.

### Manual Testing
1.  **Kanban Test:** Place two plans in the "CODED" Kanban column. Set the auto-move timer to 1 minute and click START.
2.  Watch the Reviewer terminal. Verify the first plan is dispatched normally.
3.  Verify the second (final) plan is dispatched, followed immediately by the standalone "BATCH COMPLETION NOTICE" being typed into the terminal's stdin buffer.
4.  Verify the CLI processes the final plan, then naturally executes the summary request.
