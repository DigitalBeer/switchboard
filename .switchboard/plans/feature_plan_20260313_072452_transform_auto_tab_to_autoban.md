# Transform "Auto" Tab into "Autoban" Control Center

## Goal
The introduction of the global Kanban board has made the old "Auto" sidebar tab (which triggered hardcoded pipeline workflows) obsolete. This plan transforms the "Auto" tab into the "Autoban" (Auto-Kanban) control center. It moves the complex automation configuration (timers, toggles, and batch sizes) out of the Kanban visualization and into a dedicated sidebar UI, acting as a global control panel for the autonomous factory.

## Complexity Audit
### Band A — Routine
- **Sidebar UI (`implementation.html`)**: Rename the "Auto" tab to "Autoban". Redesign the tab's DOM structure to replace old composite workflows with Kanban configuration controls.
- **Provider Binding (`TaskViewerProvider.ts`)**: Add message handlers for the new Autoban configuration toggles and inputs.

### Band B — Complex / Risky
- **State Synchronization**: The Kanban Webview (`kanban.html` / `KanbanProvider.ts`) and the Sidebar Webview (`implementation.html` / `TaskViewerProvider.ts`) must stay in sync. When settings are changed in Autoban, they must securely propagate to the active Kanban auto-move engine.
- **Timer Migration**: Moving the actual timer execution logic or interval configurations out of the Kanban webview and bridging it to the new sidebar controls.

## Edge-Case Audit
- **Split Views:** A user might have the Sidebar open but the Kanban board closed. If they toggle "Start Autoban" in the sidebar, the system must either silently start the background engine or warn them that the Kanban board must be open.
- **Global Settings vs Session State:** Autoban settings (like Batch Size = 3) need to be persisted to workspace state so they survive VS Code reloads.
- **Legacy Compatibility:** We must safely remove the old "Pipeline" and "Lead Coder + Coder" hardcoded composite buttons without breaking existing telemetry or logging.

## Adversarial Synthesis
### Grumpy Critique
You're splitting the controls from the thing they control! If I'm looking at the Kanban board, I want the timer right there on the column. If you move it to the sidebar, I have to constantly toggle back and forth to see if the timer is running. Also, syncing state between two completely different webviews in VS Code is notoriously buggy. You're going to end up with the sidebar saying "Timer On" while the Kanban board is frozen.

### Balanced Response
Grumpy is right about the danger of disconnected UIs. We will keep a *read-only visual indicator* (like a tiny glowing dot or status text) on the Kanban columns so users can see if automation is active at a glance without leaving the board. However, moving the *configuration* (batch size, intervals, target agents) to the sidebar is the right architectural move because it prevents the Kanban UI from becoming a cluttered mess of dropdowns. To ensure state consistency, we will store the master `autobanState` in the extension's workspace context, which acts as a single source of truth that broadcasts state updates down to both webviews simultaneously.

## Proposed Changes

### 1. Sidebar UI Update (`src/webview/implementation.html`)
- **Rename Tab**: Change `<button class="sub-tab-btn" data-tab="auto">Auto</button>` to `data-tab="autoban">Autoban`. Update the corresponding container ID to `agent-list-autoban`.
- **Remove Old Composites**: Delete the old hardcoded `createPipelineRow()` and `createCompositeRow()` logic in the script block.
- **Build Autoban UI**: Inject a new configuration form into the Autoban tab:
  - **Master Toggle**: `[ ] Enable Autoban Engine`
  - **Batching**: `<select>` for "Max Batch Size" (1, 3, 5).
  - **Column Rules**: A list of toggles for each column transition (e.g., `[x] Auto-move CREATED -> PLAN REVIEWED every [5] min`).
- **Emit State**: When any input changes, emit a `updateAutobanState` IPC message.

### 2. Extension State Management (`src/services/TaskViewerProvider.ts`)
- **Listen for Config**: Catch `updateAutobanState` messages from the sidebar.
- **Persist State**: Save the configuration object to `vscode.workspace.getConfiguration('switchboard').update('autoban', state)`.
- **Broadcast State**: When the state changes, find the active Kanban webview panel (if open) and send it the updated configuration via a new `kanbanProvider.updateAutobanConfig(state)` method.

### 3. Kanban Engine Update (`src/webview/kanban.html` & `KanbanProvider.ts`)
- **Clean UI**: Remove the heavy `automove-bar` (inputs, start/stop buttons) from the column headers. Replace it with a subtle read-only status indicator (e.g., `⚡ Auto: 5m (Batch: 3)` or a progress bar).
- **Receive Config**: Add a message listener in `kanban.html` for `updateAutobanConfig`. 
- **Modify Timer**: Update the internal `autoMoveState` logic to pull its rules (interval, running status, batch size) from the injected configuration rather than local DOM inputs. 
- **Batch Dispatch**: When the timer ticks, utilize the batching logic developed in the previous plan (splicing up to `Batch Size` cards and emitting an array of `sessionIds` to `KanbanProvider.ts`).

## Verification Plan
### Automated Tests
- Run `npm run compile` to ensure no interface breakages between the providers.

### Manual Testing
1. **UI Cleanliness**: Open Kanban board. Verify the clunky auto-move input bars are gone, replaced by a clean visual layout.
2. **Sidebar Migration**: Open Switchboard sidebar. Click the "Autoban" tab. Verify the old Pipeline/Team buttons are gone and the new configuration toggles are present.
3. **State Sync**: Toggle "Enable Autoban" in the sidebar. Verify the Kanban board instantly updates its visual indicators to show automation is active.
4. **Batch Execution**: Set Batch Size to 3 in the sidebar. Wait for the timer to tick on the Kanban board. Verify up to 3 cards move simultaneously and dispatch a single grouped prompt to the terminal.