# Task Tracking

## MCP polling removal execution (feature_plan_20260312_053351_remove_mcp_server_polling)

- [x] Read `accuracy.md`, `.agent/rules/WORKFLOW_INTEGRITY.md`, `.agent/rules/switchboard_modes.md`, and the source plan file.
- [x] Read impacted implementation surfaces (`src/extension.ts`) and related tests/interfaces.
- [x] Run baseline verification (`npm run compile`, `npm run lint`) and capture status.
- [x] Apply plan changes plus inline challenge corrections in `src/extension.ts`.
- [x] Verify implementation gate (`npm run compile`) and read back modified code.
- [x] Perform red-team self-review with concrete failure modes + line references.
- [x] Run final verification and diff review.

### Verification Record (MCP polling removal)

- Baseline `npm run compile`: PASS.
- Baseline `npm run lint`: FAIL (pre-existing ESLint v9 config migration issue: missing `eslint.config.*`).
- Post-change `npm run compile`: PASS.
- Final `npm run compile`: PASS.
- Final `npm run lint`: FAIL (same pre-existing ESLint config issue, unchanged by this task).
- Scoped diff review: only `src/extension.ts` logic and this `task.md` tracking section.

### Red Team Findings (MCP polling removal)

- `src/extension.ts:2712-2715` — Failure mode: non-standard packaging path could miss `mcp-server.js` and show false negative; mitigation: check both `dist` and `src` extension layouts.
- `src/extension.ts:2728-2732` — Failure mode: MCP config read exceptions were previously silent; mitigation: explicit output-channel logging plus `Unable to read IDE MCP config` diagnostic.
- `src/extension.ts:2740-2742` — Failure mode: prior diagnostic implied runtime tool health; mitigation: wording changed to static signal (`MCP server file detected`) to avoid false observability claims.
- `task.md:3-11` — Failure mode: checklist drift if execution order changes; mitigation: checklist now reflects completed gates in-order for this plan run.
- `task.md:13-19` — Failure mode: verification evidence can become stale after additional edits; mitigation: this run records baseline/post/final command outcomes explicitly.
- `task.md:21-27` — Failure mode: line references can age as file evolves; mitigation: references are snapshot-scoped to this execution block and not reused across tasks.

- [x] Read `accuracy.md`, `.agent/rules/WORKFLOW_INTEGRITY.md`, `.agent/rules/switchboard_modes.md`, and the source plan file.
- [x] Read all impacted sources and dependencies (`src/extension.ts`, `src/webview/implementation.html`, `src/services/TaskViewerProvider.ts`, related Jules tests).
- [x] Run baseline verification (`npm run compile`, `npm run lint`) and capture current status.
- [x] Implement UI/default behavior updates required by the plan (validated existing Jules setup toggle wiring in `implementation.html`).
- [x] Implement terminal creation gating in `createAgentGrid` based on visible agent settings.
- [x] Verify implementation group with compile/lint and readback.
- [x] Perform red-team self-review with concrete failure modes and line numbers.
- [x] Run final verification and diff review.

### Detailed Plan

1. Confirm current setup visibility controls in `implementation.html` and ensure Jules toggle behavior is explicit and synchronized with `lastVisibleAgents`.
2. Update `createAgentGrid` in `extension.ts` to read `await taskViewerProvider.getVisibleAgents()` and only include `Jules Monitor` when `visibleAgents.jules !== false`.
3. Run verification gate commands after implementation (`npm run compile` then `npm run lint`) and capture output.
4. Read back modified sections in both files to verify exact logic.
5. Perform red-team review on modified files and document failure modes.
6. Run final compile/lint and review git diff consistency.

### Dependency Map

- Step 2 depends on Step 1 confirming current visibility wiring in webview and provider.
- Step 3 depends on Step 2 completing both coordinated changes.
- Step 4 depends on Step 3 results.
- Step 5 depends on Step 4 readback.

### Dependencies

- `TaskViewerProvider.getVisibleAgents()` is the source of persisted visibility state from `.switchboard/state.json`.
- `renderAgentList()` already honors `lastVisibleAgents.jules` for sidebar card visibility.
- `createAgentGrid()` currently hardcodes terminal list and must align with visibility state to prevent unwanted Jules Monitor startup.

### Risks

- If `getVisibleAgents()` fails or returns defaults unexpectedly, Jules Monitor may still appear due to default `true`.
- Filtering the agents list changes cleanup behavior in `clearGridBlockers`; stale Jules terminals may persist unless explicitly handled.
- UI toggles can desynchronize if startup visibility and onboarding visibility controls are updated inconsistently.

### Verification Plan

- `npm run compile`
- `npm run lint` (expected existing config failure unless repo-level lint config changes)
- Read back modified ranges in `src/extension.ts` and `src/webview/implementation.html`
- Review git diff for only intended files and logic

### Verification Record

- Baseline `npm run compile`: PASS.
- Baseline `npm run lint`: FAIL (ESLint v9 config missing: `eslint.config.*` not present).
- Post-change `npm run compile`: PASS.
- Post-change `npm run lint`: FAIL (same pre-existing ESLint v9 config issue).
- Final `npm run compile`: PASS.
- Final `npm run lint`: FAIL (same pre-existing ESLint v9 config issue).
- Final diff review: scoped logic change confirmed in `src/extension.ts`; no `implementation.html` functional changes required because Jules setup toggle wiring already exists.
- Readback confirmed `createAgentGrid` now gates Jules terminal inclusion via `visibleAgents.jules` and disposes hidden Jules Monitor terminals (`src/extension.ts:1453-1501`).
- Readback confirmed setup still exposes Jules visibility toggle and defaults are sourced from `lastVisibleAgents` (`src/webview/implementation.html:1354`, `src/webview/implementation.html:1754`).

### Red Team Findings

- `src/extension.ts:1453-1454`: If `.switchboard/state.json` cannot be read, `getVisibleAgents()` falls back to defaults and may re-enable Jules unexpectedly.
- `src/extension.ts:1493-1499`: Name-based matching for `Jules Monitor` could dispose a user terminal with a colliding name prefix.
- `src/extension.ts:1493-1500`: Disposing the terminal does not explicitly verify child process shutdown beyond terminal lifecycle; external detached subprocesses could survive.
- `task.md:8-10`: Checklist state is manually maintained and can become inaccurate if commands are re-run but status lines are not updated in lockstep.
- `task.md:47-55`: Verification records can become stale if new command runs occur after edits and the log is not appended.
- `task.md:57-64`: Red-team findings are point-in-time; future refactors can invalidate line references without obvious signal.

## Kanban controls strip execution (feature_plan_20260316_065159_add_main_controls_strip_at_top_of_kanban_board)

- [x] Read `accuracy.md`, `.agent/rules/WORKFLOW_INTEGRITY.md`, `.agent/rules/switchboard_modes.md`, and the source plan file.
- [x] Read impacted implementation surfaces (`src/webview/kanban.html`, `src/services/KanbanProvider.ts`, `src/services/TaskViewerProvider.ts`, related types/tests).
- [x] Run baseline verification (`npm run compile`, `npm run lint`) and capture status.
- [x] Perform inline adversarial review and apply corrections before coding.
- [x] Implement controls strip UI wiring in `src/webview/kanban.html`.
- [x] Implement backend handlers/prompts/auto-advance logic in `src/services/KanbanProvider.ts`.
- [x] Verify implementation gate (`npm run compile`) and read back modified files.
- [x] Perform red-team self-review with concrete failure modes + line references.
- [x] Run final verification and diff review.

### Verification Record (Kanban controls strip)

- Baseline `npm run compile`: FAIL (pre-existing TypeScript syntax errors in `src/services/KanbanDatabase.ts`, e.g. around lines 175/187/197/202).
- Baseline `npm run lint`: NOT RUN (compile failed first in chained baseline command).
- Post-change `npm run compile` (first pass): FAIL (pre-existing `src/services/KanbanDatabase.ts` parse/syntax errors in workspace state during that run).
- Final `npm run compile`: PASS.
- Final `npm run lint`: FAIL (pre-existing ESLint v9 config migration issue: missing `eslint.config.*`).
- `npm test`: FAIL at pretest lint step (same pre-existing ESLint config issue); compile/tests setup otherwise reaches `compile-tests` and webpack compile.
- Diff/readback review completed for: `src/webview/kanban.html`, `src/services/KanbanProvider.ts`, `src/services/TaskViewerProvider.ts`, `src/extension.ts`.

### Red Team Findings (Kanban controls strip)

- `src/webview/kanban.html:455-465` — Failure mode: controls strip can wrap on narrow width and push action order around; mitigation: keep actions id-based and avoid positional assumptions in listeners.
- `src/webview/kanban.html:657-666` — Failure mode: Jules button visibility can stale if no `visibleAgents` message arrives yet; mitigation: initialize with hidden default + call `updateJulesButtonVisibility()` at startup.
- `src/webview/kanban.html:989-1004` — Failure mode: rapid multi-click on batch buttons can issue duplicate backend actions; mitigation: backend re-validates current column before advancing sessions.

- `src/services/KanbanProvider.ts:374-439` — Failure mode: stale UI snapshots could move cards already changed by other flows; mitigation: `_advanceSessionsInColumn` re-derives current column from runsheet before writing workflow event.
- `src/services/KanbanProvider.ts:781-816` — Failure mode: batch prompt buttons could claim advancement despite partial eligibility; mitigation: status messages now report actual advanced count after guarded checks.
- `src/services/KanbanProvider.ts:819-826` — Failure mode: Jules dispatch could run while Jules is disabled; mitigation: explicit `visibleAgents.jules` guard and warning before dispatch.

- `src/services/TaskViewerProvider.ts:1007-1022` — Failure mode: UI toggle desync if autoban state persisted but engine not restarted/stopped; mitigation: method updates workspace state and applies the same start/stop semantics as sidebar updates.
- `src/services/TaskViewerProvider.ts:1012-1019` — Failure mode: enabling while already enabled could keep stale timer config; mitigation: restarts engine when enabled to rehydrate active timers/rules.
- `src/services/TaskViewerProvider.ts:1021` — Failure mode: kanban indicator lag after toggle; mitigation: `_postAutobanState()` rebroadcasts to both sidebar and kanban views.

- `src/extension.ts:829-832` — Failure mode: missing command registration would make AUTOBAN button no-op; mitigation: explicit command registration routes to `TaskViewerProvider.setAutobanEnabledFromKanban`.
- `src/extension.ts:829-832` — Failure mode: non-boolean payload from webview could produce inconsistent state; mitigation: command coerces with `!!enabled`.
- `src/extension.ts:829-832` — Failure mode: un-awaited state transition could race with subsequent UI refresh; mitigation: registration awaits provider method.

- `task.md:96-136` — Failure mode: checklist drift if another edit happens after verification; mitigation: this block records exact command outcomes and touched files for this run only.
- `task.md:112-117` — Failure mode: lint/test failures could be misattributed to this feature; mitigation: records unchanged pre-existing ESLint config blocker explicitly.
- `task.md:120-136` — Failure mode: line references may age as files move; mitigation: references are scoped to this execution snapshot and should be refreshed on future edits.

## Batch summary after automated review execution (feature_plan_20260313_071421_add_a_summarise_all_plans_command_at_end_of_automated_review_session)

- [x] Read `accuracy.md`, `.agent/rules/WORKFLOW_INTEGRITY.md`, `.agent/rules/switchboard_modes.md`, the source plan file, and current `task.md`.
- [x] Read impacted implementation surfaces and dependencies (`src/services/PipelineOrchestrator.ts`, `src/services/TaskViewerProvider.ts`, `src/services/KanbanProvider.ts`, `src/extension.ts`, existing regression test).
- [x] Run baseline verification (`npm run compile`) and capture status.
- [x] Implement pipeline final-batch detection and dispatch signature updates.
- [x] Implement current automated-kanban equivalent final-review detection in the autoban engine and reviewer double-dispatch logic.
- [x] Update regression coverage / task tracking, then run verification gate (`npm run compile`) and read back modified code.
- [x] Perform red-team self-review with concrete failure modes + line references.
- [x] Run final verification and diff review.

### Detailed Plan

1. Update `PipelineOrchestrator.ts` so the dispatch callback accepts `isFinalInBatch?: boolean` and `_advance()` passes `pending.length === 1` for the last automated pipeline item.
2. Update the pipeline callback wiring in `TaskViewerProvider.ts` and the extension command bridge in `src/extension.ts` so single-plan kanban dispatches can carry the same flag without breaking existing call sites.
3. Adapt the plan’s outdated `KanbanProvider` auto-move step to the current codebase’s autoban engine in `TaskViewerProvider.ts`: detect when the reviewer dispatch drains the current column queue and pass the final-batch signal into the shared dispatch core.
4. Extend `TaskViewerProvider` reviewer dispatch logic to send a second paced reviewer message only after the primary final-plan dispatch succeeds.
5. Update regression coverage to assert the new callback/signature/final-batch flow, then verify with `npm run compile` and readback.

### Dependency Map

- Step 2 depends on Step 1 because the callback/command signatures must agree first.
- Step 3 depends on Step 4’s target dispatch API shape being settled, otherwise autoban would fork a separate path.
- Step 5 depends on Steps 1-4 being complete so verification reflects the actual final behavior.

### Inline Challenge Corrections

- The plan references `KanbanProvider._autoMoveOneCard`, but the current automated kanban path is the autoban engine in `TaskViewerProvider.ts`. Correction: implement the final-batch reviewer summary at the autoban dispatch point used today.
- `columnCards.length === 1` is fragile if the dispatch happens from a filtered/subset view. Correction: compute final-batch state from the exact pending reviewer dispatch set at dispatch time, after filtering out ineligible/in-flight sessions.
- The reviewer summary prompt must never send if the main reviewer dispatch fails. Correction: gate the second `_dispatchExecuteMessage` behind a successful first dispatch and preserve existing dedupe/error semantics.

### Risks

- A new optional dispatch flag can silently drift across `PipelineOrchestrator`, `TaskViewerProvider`, and the extension command bridge if signatures are not updated together.
- The reviewer double-dispatch could bypass pacing or clash with the dedupe lock if inserted in the wrong layer.
- Autoban batch dispatch currently uses a multi-plan prompt path; the final-summary behavior must attach only when the reviewer queue is actually drained, not on every reviewer send.

### Verification Results

- Baseline verification: `npm run compile` passed before implementation.
- Post-change verification: `npm run compile && node src\test\pipeline-orchestrator-regression.test.js` passed (`7 passed, 0 failed`).
- Final verification: reran `npm run compile && node src\test\pipeline-orchestrator-regression.test.js` and reviewed `git --no-pager diff --stat -- src/services/PipelineOrchestrator.ts src/services/TaskViewerProvider.ts src/extension.ts src/test/pipeline-orchestrator-regression.test.js task.md`.
- Modified files reviewed back after compile: `src/services/PipelineOrchestrator.ts`, `src/services/TaskViewerProvider.ts`, `src/extension.ts`, `src/test/pipeline-orchestrator-regression.test.js`.

### Red Team Findings

- `src/services/PipelineOrchestrator.ts:17` — Failure mode: callback signature drift could compile in one layer but silently drop the final-batch signal downstream; mitigation: the shared `DispatchCallback` type now carries `isFinalInBatch?: boolean`, forcing the orchestrator wiring to stay aligned.
- `src/services/PipelineOrchestrator.ts:190-214` — Failure mode: the queue could send a summary for an already-drained pipeline or for a non-final plan; mitigation: the `pending.length === 0` branch exits before dispatch, and the dispatch call passes `pending.length === 1` only for the final remaining plan.
- `src/services/PipelineOrchestrator.ts:199-214` — Failure mode: oldest-first ordering could be broken while adding the final-batch flag; mitigation: the existing `pending.sort(...)` remains intact and the new flag is computed from queue size, not from a reordered index mutation.

- `src/services/TaskViewerProvider.ts:889-981` — Failure mode: autoban reviewer batches could send the summary before the real batched review prompt or on failed dispatch; mitigation: `handleKanbanBatchTrigger(...)` sends the primary batch prompt first and only queues the summary after that `await` resolves.
- `src/services/TaskViewerProvider.ts:1425-1488` — Failure mode: a stale `columnCards.length === 1` style check would misfire when some cards are already in flight or filtered out; mitigation: the code now computes `eligibleCards` first and marks `isFinalInBatch` only when the selected batch drains that exact reviewer-eligible set.
- `src/services/TaskViewerProvider.ts:5527-5564` — Failure mode: the standalone summary could trigger workflows again or lose pacing in direct terminal mode; mitigation: the helper sends with sender `system`, sets reviewer `phase_gate` metadata with `bypass_workflow_triggers: 'true'`, and surfaces a warning if the follow-up queueing fails.
- `src/services/TaskViewerProvider.ts:6028-6035` — Failure mode: single-plan final reviewer dispatches from the pipeline could skip the summary path while autoban batches use it; mitigation: the single-plan dispatch path now calls the same `_dispatchReviewerBatchSummary(...)` helper before advancing runsheets/kanban state.

- `src/extension.ts:825-831` — Failure mode: command-bridge drift could leave the new boolean stuck in the extension layer and never reach the provider; mitigation: both single-plan and batch kanban command registrations now accept `isFinalInBatch?: boolean` and forward it to `TaskViewerProvider`.
- `src/extension.ts:825-831` — Failure mode: existing callers could break if the new flag changed argument order; mitigation: the boolean was appended as an optional trailing parameter, preserving the existing `(role, session, instruction, workspaceRoot)` call shape.
- `src/extension.ts:825-831` — Failure mode: undefined or omitted flags from older callers could be treated inconsistently; mitigation: the bridge normalizes the value with `Boolean(isFinalInBatch)` so old call sites continue to behave as non-final dispatches.

- `src/test/pipeline-orchestrator-regression.test.js:74-100` — Failure mode: future refactors could remove the final-batch callback plumb-through without obvious runtime symptoms; mitigation: the regression suite now asserts the provider callback forwards `isFinalInBatch` into `_handleTriggerAgentActionInternal(...)`.
- `src/test/pipeline-orchestrator-regression.test.js:82-87` — Failure mode: the orchestrator could stop tagging the last pending plan while still compiling; mitigation: a dedicated regex assertion now guards the `pending.length === 1` dispatch contract.
- `src/test/pipeline-orchestrator-regression.test.js:90-100` — Failure mode: reviewer summary metadata or helper usage could be dropped during later edits; mitigation: the regression suite now asserts both the helper call on final reviewer dispatch and the `batchCompletionSummary: true` metadata marker.

## Conversational kanban control via smart router (feature_plan_20260313_135545_conversational_kanban_control_via_smart_router)

- [x] Read `accuracy.md`, `.agent/rules/WORKFLOW_INTEGRITY.md`, `.agent/rules/switchboard_modes.md`, the source plan file, current `task.md`, and session `plan.md`.
- [x] Read impacted implementation surfaces and dependencies (`src/mcp-server/register-tools.js`, `src/extension.ts`, `src/services/KanbanProvider.ts`, `src/services/agentConfig.ts`, `AGENTS.md`, `src/test/workflow-contract-consistency.test.js`).
- [x] Run baseline verification and capture status.
- [x] Implement the MCP tool, extension IPC bridge, and KanbanProvider smart-router logic.
- [x] Update agent protocol documentation to advertise the new conversational routing tool.
- [x] Verify the implementation group and read back modified files.
- [x] Perform red-team self-review with concrete failure modes + line references.
- [x] Run final verification and diff review.

### Detailed Plan

1. Add a `move_kanban_card` MCP tool in `src/mcp-server/register-tools.js` that validates its inputs, emits a `triggerKanbanMove` IPC message, and returns a queueing receipt rather than falsely implying the route already succeeded.
2. Extend `src/extension.ts` to handle the new `triggerKanbanMove` IPC message and register a `switchboard.mcpMoveKanbanCard` command that delegates to `KanbanProvider`.
3. Implement `KanbanProvider.handleMcpMove(sessionId, target, workspaceRoot?)` plus private normalization helpers that resolve conversational target strings against built-in columns, built-in roles, and current custom kanban agents.
4. Preserve the plan’s smart-router intent while correcting for current architecture: apply complexity routing only for generic conversational targets like `coded` / `team`, while explicit roles or explicit custom-agent targets bypass complexity overrides.
5. Update `AGENTS.md` to document the new conversational tool in the global architecture/protocol guidance, then verify with compile plus the workflow-contract regression test.

### Dependency Map

- Step 2 depends on Step 1 because the extension can only route a tool once the MCP server emits a matching IPC message.
- Step 3 depends on Step 2 because the smart router needs a stable command entrypoint.
- Step 4 depends on Step 3 because the normalization and complexity-routing rules must share the same backend helper.
- Step 5 depends on Steps 1-4 so verification matches the real shipped flow.

### Inline Challenge Corrections

- The appendix’s immediate-success wording can mislead agents when host-side routing later fails. Correction: return a queueing receipt (`queued for routing`) from the MCP tool, keep hard errors for missing IPC, and surface extension routing failures to the human via VS Code notifications/logging.
- The sample normalization logic is too brittle for the current board because it ignores custom kanban agents and the live column model. Correction: normalize against `buildKanbanColumns(customAgents)` and explicit role aliases instead of only hardcoded strings.
- A blanket `coded -> complexity route` override would stomp explicit destinations like custom agents or an explicitly requested `lead`. Correction: restrict complexity routing to generic conversational targets (`coded`, `team`, similar aliases) and preserve explicit role/custom-agent targets as requested.

### Risks

- The new tool introduces an MCP-to-extension IPC path; mismatched message types or command registration drift would fail silently unless both ends are updated together.
- Fuzzy target normalization can accidentally map conversational input to the wrong role if aliases are too permissive.
- Session/workspace resolution must stay scoped to the correct workspace; otherwise routing could fail or target the wrong board in multi-root setups.

### Verification Results

- Baseline `npm run compile`: PASS.
- Baseline `node src\test\workflow-contract-consistency.test.js`: FAIL on pre-existing `challenge` workflow parity assertions (`markdown max phase 5 vs runtime steps 44`, unchanged baseline blocker outside this task).
- Post-change `npm run compile`: PASS.
- Post-change `node src\test\kanban-smart-router-regression.test.js`: PASS (`4 passed, 0 failed`).
- Final verification command: `npm run compile; node src\test\kanban-smart-router-regression.test.js; node src\test\workflow-contract-consistency.test.js`.
- Final exit summary: `compile=0`, `smart-router=0`, `workflow-contract=1`.
- Final `node src\test\workflow-contract-consistency.test.js`: FAIL on the same pre-existing `challenge` workflow parity assertions as baseline (unchanged by this task).
- Readback completed for `src/mcp-server/register-tools.js`, `src/extension.ts`, `src/services/KanbanProvider.ts`, `src/test/kanban-smart-router-regression.test.js`, and `AGENTS.md`.
- Scoped diff review completed for `src/mcp-server/register-tools.js`, `src/extension.ts`, `src/services/KanbanProvider.ts`, `src/test/kanban-smart-router-regression.test.js`, `AGENTS.md`, and this `task.md`.

### Red Team Findings

- `src/mcp-server/register-tools.js:2110-2145` — Failure mode: the MCP tool could falsely imply the move already succeeded even though host-side routing is asynchronous. Mitigation: the response now explicitly says the plan was *queued for routing* and preserves a hard error when IPC is unavailable.
- `src/mcp-server/register-tools.js:2121-2128` — Failure mode: empty `sessionId` or `target` inputs could generate meaningless IPC messages. Mitigation: the tool rejects blank values before emitting `triggerKanbanMove`.
- `src/mcp-server/register-tools.js:2131-2135` — Failure mode: multi-root or rehosted MCP sessions could lose workspace context during IPC. Mitigation: the message includes `workspaceRoot: getWorkspaceRoot()` so the extension can route against the correct board.

- `src/extension.ts:527-538` — Failure mode: malformed IPC payloads from the MCP child process could hit command execution with undefined inputs. Mitigation: the bridge now validates `sessionId` and `target` and logs malformed messages instead of dispatching them.
- `src/extension.ts:527-538` — Failure mode: a smart-router request could be routed against the wrong workspace in multi-root setups. Mitigation: the IPC case forwards the message’s `workspaceRoot` and falls back to the current MCP workspace root only when absent.
- `src/extension.ts:889-892` — Failure mode: the new VS Code command could drift from the provider signature during later refactors. Mitigation: `switchboard.mcpMoveKanbanCard` is a thin pass-through to `kanbanProvider.handleMcpMove(...)`, and the regression test asserts that registration shape directly.

- `src/services/KanbanProvider.ts:782-850` — Failure mode: conversational inputs like `to the planner agent` or `planner column` could fail strict alias matching. Mitigation: `_normalizeMcpTarget(...)` strips leading `to` / `the` and trailing `column|lane|stage|queue|agent|role|terminal` suffixes before alias resolution.
- `src/services/KanbanProvider.ts:810-846` — Failure mode: explicit custom-agent destinations could route to hidden or non-kanban agents and strand cards in invisible columns. Mitigation: custom-agent aliases are registered only for `includeInKanban` agents, matching the live board model.
- `src/services/KanbanProvider.ts:852-885` — Failure mode: generic conversational `coded` / `team` targets could bypass the plan’s complexity-routing requirement. Mitigation: `_resolveComplexityRoutedRole(...)` reads the plan complexity and resolves `Low -> coder`, otherwise `lead`.
- `src/services/KanbanProvider.ts:908-940` — Failure mode: routing failures could disappear silently after target normalization. Mitigation: `handleMcpMove(...)` now hard-fails on missing session, unsupported targets, invisible/unassigned roles, and downstream dispatch failure with explicit VS Code error messages.

- `src/test/kanban-smart-router-regression.test.js:41-97` — Failure mode: future edits could remove the tool, IPC bridge, or smart-router normalization without any obvious runtime signal until an agent tries the feature. Mitigation: the new regression file asserts all three seams plus the AGENTS.md protocol note.
- `src/test/kanban-smart-router-regression.test.js:67-87` — Failure mode: tests could become brittle to helper ordering rather than behavior. Mitigation: the regexes assert the presence of normalization, complexity-routing, and dispatch behavior instead of exact contiguous formatting.
- `src/test/kanban-smart-router-regression.test.js:90-97` — Failure mode: documentation drift could cause agents to keep defaulting to `send_message`. Mitigation: the regression suite asserts the AGENTS.md guidance string for `move_kanban_card`.

- `AGENTS.md:69-74` — Failure mode: agents may continue using raw `send_message` out of habit and bypass the kanban router. Mitigation: the protocol section now explicitly prefers `move_kanban_card(sessionId, target)` for conversational progression and explains the accepted target shapes.

## Add upper limit of autoban sends (feature_plan_20260317_054643_add_upper_limit_of_autoban_sends)

- [x] Read `accuracy.md`, `.agent/rules/WORKFLOW_INTEGRITY.md`, `.agent/rules/switchboard_modes.md`, the source plan file, current `task.md`, and session `plan.md`.
- [x] Read impacted implementation surfaces and dependencies (`src/services/autobanState.ts`, `src/services/TaskViewerProvider.ts`, `src/webview/implementation.html`, `src/services/KanbanProvider.ts`, `src/extension.ts`, terminal registry paths, and existing autoban regression coverage).
- [x] Run baseline verification and capture status.
- [x] Perform inline adversarial review and apply corrections before coding.
- [x] Implement autoban state extensions, terminal override dispatch plumbing, and send-limit / pool lifecycle helpers.
- [x] Implement autoban pool management UI plus provider message handlers and reset behavior.
- [x] Verify the implementation group and read back modified files.
- [x] Perform red-team self-review with concrete failure modes + line references.
- [x] Run final verification and diff review.

### Detailed Plan

1. Extend `src/services/autobanState.ts` so the persisted/broadcast autoban shape can carry per-terminal quotas, send counters, per-role pools, round-robin cursors, and a global session cap without breaking existing state hydration.
2. Update `src/services/TaskViewerProvider.ts` to normalize legacy autoban state, track per-session send counts, select an eligible terminal per role, trim each batch to the selected terminal's remaining capacity, and auto-stop when every enabled column is out of quota or the global safety cap is reached.
3. Add an optional terminal-name override to the kanban batch dispatch path so autoban can target a specific pooled terminal while preserving the existing role-based behavior for all other callers.
4. Reuse the provider's existing terminal lifecycle ownership to add backup-terminal creation/reset handlers, register those terminals into the shared Switchboard registry, and avoid auto-clearing anything unless the user explicitly presses reset.
5. Expand `src/webview/implementation.html` so the Autoban tab exposes the max-sends control, per-role pool rows with counts/status, add/remove controls up to 5 terminals per role, and a clear/reset action that also resets the running engine state.
6. Propagate the richer autoban state through `KanbanProvider` and the existing autoban regression test, then verify with compile plus focused autoban regression coverage.

### Dependency Map

- Step 2 depends on Step 1 because the provider, kanban relay, and webview all share the same autoban state contract.
- Step 3 depends on Step 2 because the pooled-terminal selector needs a stable dispatch seam before send accounting is meaningful.
- Step 4 depends on Step 3 because backup terminals must be created in the same registry shape that the selector dispatches against.
- Step 5 depends on Steps 1-4 so the UI reflects the real backend state and lifecycle operations.
- Step 6 depends on Steps 1-5 so the verification covers the shipped state model, routing seam, and UI messaging together.

### Inline Challenge Corrections

- The plan contradicts itself by calling the send cap a hardcoded floor of `10` while also requiring a numeric input with `min 1` and a verification case using `3`. Correction: implement `10` as the default/fallback, not a hard minimum, so the UI and verification flow can use smaller per-session caps.
- The proposed `sendCounts += batchSize` logic can overrun quota when `batchSize` exceeds a terminal's remaining sends. Correction: cap each autoban dispatch to the selected terminal's remaining capacity before dispatch, then increment the counter by the actual dispatched plan count.
- `handleKanbanBatchTrigger(...)` currently routes only by role, so pooled round-robin dispatch has no way to target a specific backup terminal. Correction: add an optional terminal-name override that autoban can supply while keeping the existing role-only call shape intact for everyone else.
- The plan itself flags the missing runaway safeguard. Correction: add a global autoban session cap (`200` by default) so the engine cannot keep burning through pooled terminals indefinitely even if every per-terminal quota is still positive.

### Risks

- The provider now needs to reconcile persisted autoban state across older workspace snapshots; missing-field hydration bugs could leave the engine enabled with malformed counters or empty pools.
- Creating backup terminals from the sidebar touches the same registry and heartbeat flows used by the main agent grid; naming collisions or incorrect cleanup could dispose the wrong terminal.
- Targeting specific terminals in batch dispatch changes a mature dispatch seam; any signature drift between provider callers and implementation could silently route the batch to the wrong agent.
- Pool exhaustion must stop the engine cleanly without leaving stale timers or stale countdown state behind in the sidebar and kanban views.

### Verification Results

- Baseline `npm run compile`: PASS.
- Post-backend `npm run compile`: PASS.
- Post-UI `npm run compile`: PASS.
- Final `npm run compile && node src\test\autoban-state-regression.test.js`: PASS.
- Readback completed for `src/services/autobanState.ts`, `src/services/TaskViewerProvider.ts`, `src/webview/implementation.html`, `src/extension.ts`, and `src/test/autoban-state-regression.test.js`.
- Scoped diff review completed for `src/services/autobanState.ts`, `src/services/TaskViewerProvider.ts`, `src/webview/implementation.html`, `src/extension.ts`, `src/test/autoban-state-regression.test.js`, and this `task.md`.

### Red Team Findings

- `src/services/autobanState.ts:35-44` — Failure mode: malformed persisted numeric values could silently resurrect bad quotas or cursor state after reload. Mitigation: `normalizeFiniteCount(...)` now rejects non-finite and below-minimum values and restores safe defaults instead of trusting raw workspace state.
- `src/services/autobanState.ts:57-74` — Failure mode: duplicate/blank terminal names in stored pools could over-count capacity or create phantom pool entries. Mitigation: `normalizeStringArrayRecord(...)` trims, dedupes, and caps each role pool at five entries.
- `src/services/autobanState.ts:94-123` — Failure mode: older workspaces without the new autoban fields could crash the provider/webview or lose relay shape. Mitigation: `normalizeAutobanConfigState(...)` supplies defaults for all new fields (`maxSendsPerTerminal`, `globalSessionCap`, counters, pools, and cursors) while preserving the existing rule defaults.

- `src/services/TaskViewerProvider.ts:922-950` — Failure mode: a pooled autoban send targeting one specific backup terminal could accidentally fall through to the old single-plan role path and lose the override. Mitigation: `handleKanbanBatchTrigger(...)` only uses the single-plan shortcut when no `targetTerminalOverride` is present.
- `src/services/TaskViewerProvider.ts:1341-1458` — Failure mode: explicit user-managed pools could silently fall back to arbitrary same-role terminals when configured pool members went offline. Mitigation: `_resolveAutobanEffectivePool(...)` now honors explicit pools strictly and only falls back to all live same-role terminals when no stored pool exists.
- `src/services/TaskViewerProvider.ts:1461-1481` — Failure mode: `batchSize > remaining sends` could over-consume quota and mis-rotate the next terminal. Mitigation: `_recordAutobanDispatch(...)` records only the actual dispatched plan count, and `_selectAutobanTerminal(...)` exposes the true remaining capacity per terminal.
- `src/services/TaskViewerProvider.ts:1587-1679` — Failure mode: backup-terminal creation could exceed the intended five-terminal cap when some configured pool members were offline. Mitigation: `_createAutobanTerminal(...)` now counts the stored pool size when present, not just the currently alive subset, before allowing another backup to be created.
- `src/services/TaskViewerProvider.ts:1700-1718` — Failure mode: reset/removal paths could leave stale pool references or counters behind and keep autoban routing to dead names. Mitigation: `_resetAutobanPools()` and `_removeAutobanTerminalReferences(...)` clear stored pool membership, managed backup membership, and send counters together before rebroadcasting state.
- `src/services/TaskViewerProvider.ts:1757-1770` — Failure mode: innocuous config changes while autoban is already enabled could accidentally reset a live send-count session. Mitigation: `setAutobanEnabledFromKanban(...)` only resets counters on a true disabled->enabled session start; rule restarts keep current counters intact.
- `src/services/TaskViewerProvider.ts:2016-2148` — Failure mode: autoban could keep dispatching forever across a large pool or overrun a terminal quota mid-batch. Mitigation: `_autobanTickColumn(...)` now enforces the hidden global session cap, trims each dispatch to the selected terminal's remaining capacity, and auto-stops once every enabled autoban role is exhausted.
- `src/services/TaskViewerProvider.ts:2511-2558` — Failure mode: webview-triggered pool actions could mutate live autoban counters accidentally or leave the engine running with stale timers. Mitigation: the new message handlers keep config updates, max-send updates, add/remove terminal actions, and clear/reset behavior on separate backend paths with explicit persistence and rebroadcast.
- `src/services/TaskViewerProvider.ts:5979-6012` — Failure mode: closing a managed backup terminal outside the autoban UI could strand stale pool entries and make the remaining pool count lie. Mitigation: `handleTerminalClosed(...)` now removes closed terminal references from stored autoban pools/counters as part of terminal cleanup.

- `src/webview/implementation.html:1949-1966` — Failure mode: sidebar startup before the first backend sync could render missing-field errors or undefined send-count badges. Mitigation: the local `autobanState` bootstrap now includes defaults for all new counter/pool fields.
- `src/webview/implementation.html:2326-2329` — Failure mode: inbound autoban syncs could partially update the UI and leave stale runtime counters or pools on screen. Mitigation: the webview still merges the full backend autoban payload and immediately rerenders the sidebar after every `autobanStateSync`.
- `src/webview/implementation.html:2899-3335` — Failure mode: posting the full autoban state back to the extension on every toggle change would overwrite live counters/pools with stale UI copies. Mitigation: `emitAutobanState()` now sends only the editable config subset, while `updateAutobanMaxSends`, `addAutobanTerminal`, `removeAutobanTerminal`, and `resetAutobanPools` use dedicated messages.
- `src/webview/implementation.html:2932-2952` — Failure mode: the pool list could misrepresent explicit pools versus ad-hoc same-role terminals and confuse the operator. Mitigation: `getRolePoolEntries(...)` shows the configured pool when one exists, otherwise it falls back to the live same-role terminals, matching the backend routing contract.
- `src/webview/implementation.html:3184-3335` — Failure mode: operators could destroy backup terminals accidentally with no review step. Mitigation: managed backups expose explicit remove buttons, and the destructive `CLEAR & RESET` path now requires a confirmation prompt.

- `src/extension.ts:844-845` — Failure mode: the new terminal override could get lost in the extension bridge even though the provider supports it. Mitigation: `switchboard.triggerBatchAgentFromKanban` now forwards the trailing `targetTerminalOverride?: string` argument directly to `TaskViewerProvider.handleKanbanBatchTrigger(...)`.
- `src/extension.ts:844-845` — Failure mode: existing callers could break if the new override changed the established argument order. Mitigation: the terminal override was appended as a trailing optional parameter, preserving the existing `(role, sessionIds, instruction, workspaceRoot, isFinalInBatch)` call shape.
- `src/extension.ts:844-845` — Failure mode: the final-batch boolean and terminal override could be conflated by later edits. Mitigation: the bridge still normalizes the boolean separately with `Boolean(isFinalInBatch)` and forwards the terminal override as a distinct final argument.

- `src/test/autoban-state-regression.test.js:12-49` — Failure mode: future edits could drop the new quota/pool fields from the broadcast state while still compiling. Mitigation: the regression now asserts preservation of per-terminal caps, global session cap, session send counts, pool membership, managed backups, and pool cursor state.
- `src/test/autoban-state-regression.test.js:51-95` — Failure mode: legacy workspaces or malformed persisted pool config could regress restore behavior without any UI smoke test catching it. Mitigation: the regression now locks defaulting/clamping behavior for legacy state, invalid caps, send counts, deduped pool entries, and pool cursor normalization.
- `src/test/autoban-state-regression.test.js:97-118` — Failure mode: a later refactor could remove the pooled-autoban provider hooks or sidebar controls without touching the shared state codec. Mitigation: the regression also inspects the provider and webview sources for the new selection helper, pool-management messages, terminal-override seam, and visible sidebar controls.

- `task.md:274-324` — Failure mode: checklist drift could hide an incomplete accuracy phase if the execution order changes later. Mitigation: this section records the completed gates in the same order the work was actually performed.
- `task.md:317-324` — Failure mode: verification notes can go stale if future commands are run and not recorded. Mitigation: the section captures baseline, post-backend, post-UI, and final verification outcomes separately for this task run.
- `task.md:326-357` — Failure mode: line references in red-team notes age as files continue to move. Mitigation: these findings are snapshot-scoped to this execution and should be refreshed on any later edit pass.

## Fix complexity parsing bug (feature_plan_20260317_113032_fix_complexity_parsing_bug)

- [x] Read `accuracy.md`, `.agent/rules/WORKFLOW_INTEGRITY.md`, `.agent/rules/switchboard_modes.md`, the source plan file, current `task.md`, and session `plan.md`.
- [x] Read impacted implementation surfaces and dependencies (`src/services/KanbanProvider.ts`, `src/mcp-server/register-tools.js`, `src/services/TaskViewerProvider.ts`, and `src/test/kanban-complexity.test.ts`).
- [x] Run baseline verification and capture status.
- [x] Perform inline adversarial review and apply corrections before coding.
- [x] Implement aligned complexity parser fixes in the kanban provider and MCP registry.
- [x] Extend focused regression coverage, verify the implementation group, and read back modified code.
- [x] Perform red-team self-review with concrete failure modes + line references.
- [x] Run final verification and diff review.

### Detailed Plan

1. Update `src/services/KanbanProvider.ts` so `getComplexityFromPlan(...)` ignores label-only Band B heading text such as `(Complex/Risky)` and `— Complex / Risky`, and only treats substantive Band B items as High complexity.
2. Mirror the same normalization in `src/mcp-server/register-tools.js` so `get_kanban_state` and the kanban UI do not drift.
3. Extend `src/test/kanban-complexity.test.ts` with the exact failing markdown shape from the source plan plus a true High-complexity Band B case.
4. Verify with `npm run compile` and focused complexity regression coverage, then read back the changed code before red-team review.

### Dependency Map

- Step 2 depends on Step 1 because the MCP parser must stay aligned with the canonical kanban parser behavior.
- Step 3 depends on Steps 1-2 so the regression cases lock the final shared behavior instead of a partially fixed parser.
- Step 4 depends on Steps 1-3 so compile/test evidence reflects the shipped parser logic end-to-end.

### Inline Challenge Corrections

- The current parser assumes any non-empty text after `Band B` is meaningful, which wrongly counts same-line labels like `(Complex/Risky)` as real work. Correction: ignore label-only Band B heading text before checking for `None` or substantive bullets.
- `src/mcp-server/register-tools.js` duplicates the same complexity parsing logic. Correction: patch both implementations in the same change so the UI, routing, and `get_kanban_state` stay consistent.
- The existing focused test already covers a failing `### Band B (Complex/Risky)` + `- None.` case but has not been part of routine verification. Correction: rerun that regression and add an explicit High case so the parser boundary is locked from both sides.

### Risks

- Over-normalizing Band B text could accidentally discard genuine complex bullets if the matcher is too broad.
- Fixing only the TypeScript parser would leave MCP complexity reporting stale and make the system disagree about the same plan.
- Broad regex edits in parser code can silently change fallback behavior for plans that do not contain a `Complexity Audit` section.

### Verification Results

- Baseline `npm run compile`: PASS.
- Implementation verification `npm run compile-tests && npm run compile && node src\test\kanban-complexity-regression.test.js`: PASS.
- Final verification `npm run compile-tests && npm run compile && node src\test\kanban-complexity-regression.test.js`: PASS.
- Final diff review: `git --no-pager diff --stat -- src/services/KanbanProvider.ts src/mcp-server/register-tools.js src/test/kanban-complexity.test.ts src/test/kanban-complexity-regression.test.js task.md` reviewed after verification. Note: the new standalone regression file is untracked, so Git's tracked-file diff stat only reported the tracked file subset.
- Readback completed for `src/services/KanbanProvider.ts`, `src/mcp-server/register-tools.js`, `src/test/kanban-complexity.test.ts`, and `src/test/kanban-complexity-regression.test.js`.

### Red Team Findings

- `src/services/KanbanProvider.ts:59-60` — Failure mode: the type contract with `TaskViewerProvider` could drift again and break `compile-tests`. Mitigation: restored an explicit `getCodedColumnTarget()` method that returns the live legacy default `'lead'` instead of depending on removed state.
- `src/services/KanbanProvider.ts:748-757` — Failure mode: parenthesized Band B labels such as `(Complex/Risky)` could still be misread as substantive work. Mitigation: `normalizeBandBLine()` now unwraps parenthesized heading labels and strips heading punctuation before classification.
- `src/services/KanbanProvider.ts:760-776` — Failure mode: label-only lines or embedded recommendation markers inside Band B could still force false High complexity. Mitigation: the final `meaningful` filter now excludes empty markers, pure Band B labels, and `Recommendation` prefixes before deciding `Low` vs `High`.

- `src/mcp-server/register-tools.js:637-657` — Failure mode: MCP `get_kanban_state` could disagree with the UI on the same `(Complex/Risky) + None` plan shape. Mitigation: the MCP parser now mirrors the same normalization, label stripping, and empty-marker checks as `KanbanProvider`.
- `src/mcp-server/register-tools.js:663-668` — Failure mode: recommendation-only plans without a formal `Complexity Audit` could remain `unknown` in MCP while the UI/runtime classify them. Mitigation: `getComplexityFromContent()` now matches lead/coder recommendation text before falling back to `unknown`.
- `src/mcp-server/register-tools.js:674-685` — Failure mode: Band B extraction could absorb later headings or recommendation sections and produce false High ratings. Mitigation: the section-boundary regex now stops at headings, later band markers, recommendation labels, and horizontal rules before normalization.

- `src/test/kanban-complexity.test.ts:9-43` — Failure mode: the exact user-reported `(Complex/Risky)` + `- None.` case could regress if only generic low-complexity fixtures were covered. Mitigation: the low-case test keeps the precise failing markdown shape in the future VS Code test harness.
- `src/test/kanban-complexity.test.ts:45-79` — Failure mode: over-correcting the parser could accidentally downgrade real Band B work to `Low`. Mitigation: the added high-case test locks substantive Band B bullets to `High`.
- `src/test/kanban-complexity.test.ts:12-18` and `48-54` — Failure mode: test scaffolding could become coupled to a broader fake VS Code context and hide environment-specific failures. Mitigation: both tests keep the context stub minimal (`workspaceState.get` only), reducing incidental behavior assumptions.

- `src/test/kanban-complexity-regression.test.js:10-13` — Failure mode: the MCP parser could become harder to verify directly and drift silently. Mitigation: `getComplexityFromContent` is now exported and exercised directly by the standalone regression.
- `src/test/kanban-complexity-regression.test.js:79-90` — Failure mode: future edits could break recommendation-only fallback alignment without touching Band B parsing. Mitigation: the standalone regression now locks both coder and lead recommendation-only classifications.
- `src/test/kanban-complexity-regression.test.js:92-100` — Failure mode: a Node-only regression cannot instantiate the VS Code-backed provider runtime, so source-only assertions could miss behavioral drift there. Mitigation: this lightweight regression is paired with the stronger provider-facing Mocha suite in `src/test/kanban-complexity.test.ts`.

- `task.md:360-430` — Failure mode: checklist drift could make an accuracy phase look complete when verification or review has not actually happened. Mitigation: this section now records the complexity-fix task in the exact order it was executed, from context gathering through final diff review.
- `task.md:396-404` — Failure mode: verification evidence can become stale after additional edits. Mitigation: the command sequence that passed is captured explicitly, including `compile-tests`, `compile`, and the standalone regression.
- `task.md:406-430` — Failure mode: line references in the hostile review will age as files continue to move. Mitigation: these findings are snapshot-scoped to this execution and should be refreshed on any later edit pass.

## Autoban prompt parity execution (feature_plan_20260317_160207_autoban_prompts_are_terrible)

- [x] Read `accuracy.md`, `.agent/rules/WORKFLOW_INTEGRITY.md`, `.agent/rules/switchboard_modes.md`, the source plan file, and current `task.md`.
- [x] Read impacted implementation surfaces and dependencies (`src/services/TaskViewerProvider.ts`, `src/test/kanban-batch-prompt-regression.test.js`, `src/test/challenge-prompt-regression.test.js`, reviewer prompt regression coverage).
- [x] Run baseline verification (`npm run compile-tests`, `npm run compile`, `npm run lint`) and capture status.
- [x] Refactor reviewer autoban/batch prompt wording so it matches manual reviewer intent for single-plan and multi-plan sends.
- [x] Audit planner/coder/lead autoban prompt branches for manual-parity regressions and adjust only if needed.
- [x] Add focused regression coverage for reviewer autoban prompt semantics and any shared prompt helper introduced.
- [x] Verify implementation gate (`npm run compile`, targeted prompt tests) and read back changed code.
- [x] Perform red-team self-review with concrete failure modes + line references.
- [x] Run final verification and diff review.

### Detailed Plan

1. Inspect the existing autoban batch prompt builder and the manual single-plan reviewer payload to identify the smallest shared prompt-intent seam.
2. Refactor `src/services/TaskViewerProvider.ts` so reviewer batch/autoban prompts clearly describe code review against implementation and the plan requirements, while preserving existing planner/coder/lead semantics and inline challenge behavior.
3. Handle the single-plan autoban + `targetTerminalOverride` case by making the batch prompt builder emit reviewer-executor semantics equivalent to the manual path without changing routing side effects.
4. Add prompt-focused regression tests that assert reviewer batch prompts mention code review / implementation review, reference plan requirements as criteria, and avoid ambiguous “review the plan” framing.
5. Re-run compile plus focused prompt regressions, then read back modified ranges and review the diff before red-team review.

### Dependency Map

- Step 2 depends on Step 1 confirming the exact wording and structure used by the manual reviewer path.
- Step 3 depends on Step 2 because the single-plan override case should reuse the same reviewer intent rather than add a third prompt variant.
- Step 4 depends on Steps 2-3 settling the new prompt contract.
- Step 5 depends on Steps 2-4 being complete so verification reflects the real shipped behavior.

### Risks

- Reviewer autoban wording could drift again if manual and batch prompts continue to duplicate role intent in multiple places.
- Tightening reviewer language must not accidentally change planner/coder/lead batch prompt behavior or break lead inline challenge / coder accuracy instructions.
- Prompt-focused regressions that rely on brittle raw strings can create false failures unless they assert semantic anchors rather than byte-for-byte text.

### Verification Plan

- `npm run compile-tests`
- `npm run compile`
- `npm run lint` (expected pre-existing ESLint v9 config failure unless repo config changes)
- `node src\test\kanban-batch-prompt-regression.test.js`
- focused autoban prompt regression test(s)
- read back modified `TaskViewerProvider.ts` and test files

### Verification Record

- Baseline `npm run compile-tests`: PASS.
- Baseline `npm run compile`: PASS.
- Baseline `npm run lint`: FAIL (pre-existing ESLint v9 config migration issue: missing `eslint.config.*`).
- Implementation verification: `npm run compile-tests`, `npm run compile`, `node src\test\autoban-reviewer-prompt-regression.test.js`, and `node src\test\challenge-prompt-regression.test.js`: PASS.
- Final verification: `npm run compile-tests`, `npm run compile`, `node src\test\autoban-reviewer-prompt-regression.test.js`, `node src\test\challenge-prompt-regression.test.js`, and `node src\test\kanban-batch-prompt-regression.test.js`: PASS.
- Readback review completed for `src/services/TaskViewerProvider.ts` shared reviewer helpers, reviewer autoban batch branch, manual reviewer prompt branch, and `src/test/autoban-reviewer-prompt-regression.test.js`.
- Final scoped diff review: `git --no-pager diff --stat -- src\services\TaskViewerProvider.ts src\test\autoban-reviewer-prompt-regression.test.js task.md` plus scoped diff output confirmed only intended reviewer prompt parity / task tracking changes in this execution block.

### Red Team Findings

- `src/services/TaskViewerProvider.ts:989-1002` — Failure mode: manual and autoban reviewer semantics could drift again if one path stops using the shared intro/mode helpers; mitigation: both single-plan reviewer prompts and the reviewer batch branch now call `_buildReviewerExecutionIntro(...)` / `_buildReviewerExecutionModeLine(...)`.
- `src/services/TaskViewerProvider.ts:2016-2035` — Failure mode: reviewer autoban could regress back into plan-review wording and send the wrong task framing to pooled reviewer terminals; mitigation: the reviewer batch branch now explicitly says implementation/code review, anchors against plan requirements, and calls out per-plan validation results.
- `src/services/TaskViewerProvider.ts:2017-2019` — Failure mode: singular pooled sends could sound plural or ambiguous in the single-plan override case; mitigation: `planTarget` and `_buildReviewerExecutionIntro(plans.length)` switch wording between `this plan` and `each listed plan`.
- `src/services/TaskViewerProvider.ts:6833-6869` — Failure mode: tightening autoban reviewer prompts could accidentally weaken the manual reviewer flow; mitigation: the manual light/strict reviewer prompts retain their existing downstream requirements while reusing the shared reviewer-executor intro/mode contract.

- `src/test/autoban-reviewer-prompt-regression.test.js:11-46` — Failure mode: a future refactor could reintroduce ambiguous reviewer batch wording without changing runtime types or compile output; mitigation: the regression asserts shared helper presence plus implementation-review / plan-requirements anchors.
- `src/test/autoban-reviewer-prompt-regression.test.js:31-37` — Failure mode: the old `Please review the following ... plans` phrasing could quietly return and pass weaker tests; mitigation: the regression explicitly forbids both prior ambiguous reviewer strings.
- `src/test/autoban-reviewer-prompt-regression.test.js:43-45` — Failure mode: exact newline/indent assertions can false-fail on harmless formatting churn; mitigation: the per-plan guidance assertion now uses a newline-tolerant regex instead of a brittle raw string.

- `task.md:428-436` — Failure mode: checklist state can drift from actual implementation/verification progress if this block is not updated immediately after each gate; mitigation: all execution items for this plan are now closed out in the same run that completed verification.
- `task.md:468-477` — Failure mode: verification evidence can become misleading if only implementation-pass results are recorded; mitigation: this block now distinguishes baseline, implementation verification, and final verification command sets.
- `task.md:479-489` — Failure mode: red-team notes can lose value if they omit the new regression file or shared-helper seam; mitigation: this section records concrete failure modes for `TaskViewerProvider.ts`, the reviewer prompt regression test, and this task artifact itself.
