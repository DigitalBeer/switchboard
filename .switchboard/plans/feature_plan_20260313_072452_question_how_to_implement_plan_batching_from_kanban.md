Here is the complete, comprehensive implementation plan incorporating the hybrid approach (Global Toggle + Shift-Click Multi-Select).

***

# Implement Kanban Timer-Based Auto-Batching

## Goal
Enhance the existing Kanban auto-move timer to support bounded batch processing. Instead of dispatching one plan per timer tick, allow the user to select a batch size (e.g., 3) so the system can group multiple plans into a single prompt. This allows AI clients with sub-agent capabilities to process them in parallel, saving time and context tokens, while strictly capping the batch size to prevent AI context hallucination.

## Complexity Audit
### Band A — Routine
* **Webview UI (`kanban.html`)**: Update the existing timer control bar to include a "Batch Size" `<select>` dropdown (options: 1, 3, 5).
* **Command Registry**: Update IPC messages and command signatures to pass an array of `sessionIds` instead of a single string.

### Band B — Complex / Risky
* **State Management**: `TaskViewerProvider` must iterate over the array of batched `sessionIds` and successfully update *each* runsheet synchronously or via `Promise.all` so the Kanban board accurately advances all cards simultaneously.
* **Prompt Construction**: Generating a unified batch payload that safely bounds the AI.

## Edge-Case Audit
* **Race Conditions:** Updating multiple runsheets simultaneously could cause file-locking contention in `SessionActionLog`. We will use sequential `for...of` awaiting for runsheet updates to ensure deterministic writes before dispatching the prompt.
* **Insufficient Backlog:** If the timer ticks and the batch size is set to 3, but only 2 cards are left in the column, the system must gracefully handle processing just the remaining 2.
* **AI Hallucination:** Batching too many files into a single prompt risks context bleed. The hard cap of 3-5 ensures the LLM can safely dispatch parallel sub-agents without mixing requirements.

## Adversarial Synthesis
### Grumpy Critique
Why are we grouping these at all? If one plan fails to compile, the AI is going to get confused and halt the whole batch! And what happens when a user sets the batch size to 5, but the AI platform they are using doesn't support parallel sub-agents? It's just going to lock up their terminal for an hour while it grinds through 5 tasks sequentially.

### Balanced Response
Grumpy is right that failure isolation is harder in a batch. However, by strictly bounding the batch size (defaulting to 3) rather than letting users select 20 items, we minimize context bleed. To address the sequential grinding risk, the prompt will explicitly instruct the AI: "If your platform supports parallel sub-agents, dispatch one per plan. If not, process them sequentially." This is an opt-in feature specifically designed to optimize workflows for advanced users utilizing agents like Cascade or Claude Code that *can* handle parallel sub-agent routing. For safety, the default batch size will remain 1.

## Proposed Changes

### 1. Kanban Webview UI (`src/webview/kanban.html`)
* **Modify Auto-Move Bar**: In the column headers where the auto-move timer currently exists, add a `<select id="batch-size" class="switchboard-dropdown">` with options `1` (default), `3`, and `5`.
* **Update Timer Logic**: When the timer ticks down to 0, instead of getting just the first card `const firstCard = cards[0];`, read the value of the `batch-size` dropdown. Splice up to that many cards from the column: `const batchCards = Array.from(cards).slice(0, batchSize);`.
* **Emit Batch Payload**: Update the IPC message to `autoMoveBatch` and pass an array of IDs: `sessionIds: batchCards.map(c => c.dataset.session)`.

### 2. Kanban Backend Provider (`src/services/KanbanProvider.ts`)
* **Listen to New Message**: Update the webview message listener to handle `autoMoveBatch`.
* **Dispatch**: Forward the array of IDs to the extension command:
  ```typescript
  await vscode.commands.executeCommand('switchboard.triggerBatchAgentFromKanban', role, msg.sessionIds, instruction);
  ```

### 3. Extension Command Registry (`src/extension.ts`)
* Update the batch command to bridge the Kanban Provider to the Task Viewer Provider:
  ```typescript
  vscode.commands.registerCommand('switchboard.triggerBatchAgentFromKanban', async (role: string, sessionIds: string[], instruction?: string) => {
      taskViewerProvider.handleKanbanBatchTrigger(role, sessionIds, instruction);
  });
  ```

### 4. Task Viewer Provider Engine (`src/services/TaskViewerProvider.ts`)
* **Create `handleKanbanBatchTrigger(role, sessionIds[], instruction)`**:
    1. Resolve all valid, active plan absolute paths from the provided `sessionIds`.
    2. Iterate through the valid IDs and `await this._updateSessionRunSheet(id, workflowName)` for each to advance their state on the Kanban board.
    3. Construct the aggregated parallel prompt:
       ```typescript
       let prompt = `Please process the following ${validPlans.length} plans.
If your platform supports parallel sub-agents, dispatch one sub-agent per plan to execute them concurrently. If not, process them sequentially.

CRITICAL INSTRUCTIONS:
1. Treat each file path below as a completely isolated context. Do not mix requirements.
2. Upon completing ALL plans, save a read receipt to the inbox.

PLANS TO PROCESS:\n`;
       
       for (const plan of validPlans) {
           prompt += `- [${plan.topic}](${plan.uri})\n`;
       }
       ```
    4. Call `_dispatchExecuteMessage` to send the payload to the target terminal.

## Verification Plan
### Manual Testing
1. **Timer UI**: Open Kanban. Verify the new "Batch Size: [1]" dropdown appears next to the auto-move timers.
2. **Partial Batch**: Set batch size to 3. Have only 2 cards in the `CREATED` column. Start the timer.
    * *Verify:* When the timer hits 0, both cards move simultaneously.
    * *Verify:* The terminal receives a prompt specifying "2 plans".
3. **Full Batch**: Place 5 cards in `PLAN REVIEWED`. Set batch size to 3. Start timer.
    * *Verify:* When timer hits 0, exactly 3 cards move. The remaining 2 stay put.
    * *Verify:* The terminal receives a prompt specifying "3 plans" with their exact file paths.
4. **Safety Check**: Verify standard drag-and-drop of single cards remains unaffected and dispatches the standard single-plan prompt.

***

**Would you like me to begin implementing these changes, starting with the frontend UI multi-select and drag-and-drop modifications in `kanban.html`?**