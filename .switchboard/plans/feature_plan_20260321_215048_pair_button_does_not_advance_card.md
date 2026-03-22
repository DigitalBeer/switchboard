# Pair button does not advance card

## Goal
For cards in the planned column, the pair button needs to advance the card to the lead coder column automatically, just like the copy prompt button does.

## User Review Required
> [!NOTE]
> Users clicking the Pair button will now see the card immediately move to LEAD CODED.

## Complexity Audit
### Band A — Routine
- Add the forward move command to the `pairProgramCard` action handler in `KanbanProvider.ts`.
### Band B — Complex / Risky
- None

## Edge-Case & Dependency Audit
- **Race Conditions:** None.
- **Security:** None.
- **Side Effects:** The UI will visibly shift the card to a new column.
- **Dependencies & Conflicts:** Relies on the existing `switchboard.kanbanForwardMove` command.

## Adversarial Synthesis
### Grumpy Critique
"Wait, if you fire the `switchboard.kanbanForwardMove` command asynchronously after sending everything to the clipboard and terminal, what if the command fails? Does the user know why? Also, what column are you moving it to? If it's dynamically calculated, you better not hardcode 'LEAD CODED'!"

### Balanced Response
"Grumpy makes a good point about hardcoding columns, but in this specific feature ('Pair Program is only available for PLAN REVIEWED cards'), we know the card is exclusively in the PLAN REVIEWED column and the next logical step in the pipeline is always LEAD CODED (or the designated 'forward' column). `switchboard.kanbanForwardMove` calculates the next column automatically if we just pass the target column we want, or we can use the backend logic. Wait, looking at the extension commands, `kanbanForwardMove` takes `(sessionIds, targetColumn)`. The copy prompt button uses `promptSelected` which relies on frontend logic or backend forward move. We will command the move to 'LEAD CODED'."

## Proposed Changes
> [!IMPORTANT]
> **MAXIMUM DETAIL REQUIRED:** Provide complete, fully functioning code blocks. Break down the logic step-by-step before showing code.

### `src/services/KanbanProvider.ts`
#### MODIFY `src/services/KanbanProvider.ts`
- **Context:** The `pairProgramCard` case currently only dispatches the prompts but leaves the card lingering in the `PLAN REVIEWED` column.
- **Logic:** After dispatching to the coder terminal, we trigger the move command to advance the specific card to `LEAD CODED`.
- **Implementation:**
```typescript
            case 'pairProgramCard': {
                const card = this._lastCards.find(c => c.sessionId === msg.sessionId);
                if (!card || !this._currentWorkspaceRoot) { break; }
                if (card.column !== 'PLAN REVIEWED') {
                    vscode.window.showWarningMessage('Pair Program is only available for PLAN REVIEWED cards.');
                    break;
                }

                const plans = this._cardsToPromptPlans([card], this._currentWorkspaceRoot);

                // Build lead (Band B) prompt — with pair programming note
                const leadPrompt = buildKanbanBatchPrompt('lead', plans, { pairProgrammingEnabled: true });

                // Build coder (Band A) prompt
                const coderPrompt = buildKanbanBatchPrompt('coder', plans, { pairProgrammingEnabled: true });

                // Copy lead prompt to clipboard for the IDE agent
                await vscode.env.clipboard.writeText(leadPrompt);
                vscode.window.showInformationMessage('Band B prompt copied to clipboard. Dispatching Band A to Coder terminal...');

                // Auto-dispatch Band A to Coder terminal
                await vscode.commands.executeCommand('switchboard.dispatchToCoderTerminal', coderPrompt);

                // Advance the card to LEAD CODED
                await vscode.commands.executeCommand('switchboard.kanbanForwardMove', [msg.sessionId], 'LEAD CODED', msg.workspaceRoot);
                break;
            }
```
- **Edge Cases Handled:** The move is executed safely at the end of the operation, ensuring that if terminal dispatch fails, the move isn't orphaned or misaligned.

## Verification Plan
### Automated Tests
- Click the "Pair" button on a High Complexity plan. Verify prompt copied, terminal dispatched, and card moves to the next column.

## Open Questions
- None

---

## Code Review (2026-03-21)

### Stage 1 — Grumpy Principal Engineer

> "Ladies and gentlemen, we have a SHOW-STOPPER. The entire point of this feature — the ONE thing it needed to do beyond the prompt stuff — is advance the card. And it's BROKEN. Let me spell it out for you:"
>
> "The `switchboard.kanbanForwardMove` command is registered in `extension.ts:998` as:"
> ```typescript
> vscode.commands.registerCommand('switchboard.kanbanForwardMove',
>     async (sessionIds: string[], targetColumn: string, workspaceRoot?: string) => { ... }
> );
> ```
> "That's THREE POSITIONAL ARGUMENTS. Every single other caller in `KanbanProvider.ts` — lines 1132, 1188, 1191, 1296, 1317, 1320, 1353, 1368, 1371, 1405, 1408, 1445, 1451 — calls it like:"
> ```typescript
> await vscode.commands.executeCommand('switchboard.kanbanForwardMove', sessionIds, targetColumn, workspaceRoot);
> ```
> "But OUR implementation? Oh no, someone decided to be *creative*:"
> ```typescript
> await vscode.commands.executeCommand('switchboard.kanbanForwardMove', {
>     sessionIds: [msg.sessionId],
>     targetColumn: 'LEAD CODED',
>     workspaceRoot: this._currentWorkspaceRoot
> });
> ```
> "That's a SINGLE OBJECT argument. So `sessionIds` receives `{ sessionIds: [...], targetColumn: '...', ... }` — which is NOT a string array. `targetColumn` is `undefined`. `workspaceRoot` is `undefined`. The move silently fails. The card NEVER advances. The user clicks Pair, gets their prompts copied, but the card just... sits there. Mocking them. From the PLAN REVIEWED column. FOREVER."
>
> "Also — minor note — the plan says `msg.workspaceRoot` but the implementation uses `this._currentWorkspaceRoot`. That's actually *better* since `this._currentWorkspaceRoot` is the resolved root, but it's a deviation from the plan spec."
>
> - **[CRITICAL]** `kanbanForwardMove` called with object arg instead of positional args — card advance is completely non-functional.
> - **[NIT]** Uses `this._currentWorkspaceRoot` instead of `msg.workspaceRoot` — functionally superior but deviates from plan text.

### Stage 2 — Balanced Synthesis

Grumpy's CRITICAL finding is dead-on. The object-style invocation is incompatible with the command's positional parameter registration. This was fixed by switching to positional args matching the exact convention used by all 13+ other callers in the same file. The NIT about `this._currentWorkspaceRoot` vs `msg.workspaceRoot` is intentionally kept — it's more reliable since it's already resolved.

### Fixed Items
- **[CRITICAL] Positional args restored** for `kanbanForwardMove` call in `pairProgramCard` handler at `KanbanProvider.ts:1523`

### Files Changed
- `src/services/KanbanProvider.ts` — Changed `kanbanForwardMove` invocation from single-object to positional args: `([msg.sessionId], 'LEAD CODED', this._currentWorkspaceRoot)`

### Validation Results
- `tsc --noEmit`: **PASS** (exit code 0)
- All kanban test suites (9/9): **PASS**
- All autoban test suites (3/3): **PASS**

### Remaining Risks
- **[NIT/ACCEPTED]** `this._currentWorkspaceRoot` used instead of `msg.workspaceRoot` — functionally superior, no action needed