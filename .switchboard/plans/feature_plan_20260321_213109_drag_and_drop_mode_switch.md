# Drag and Drop Mode Switch

## Goal
Add a per-column mode switch to the Kanban board that controls whether dragging a card into a column triggers a **CLI agent dispatch** (current default) or **copies the prompt to the clipboard** (same behaviour as the existing "Copy Prompt" icon buttons). The toggle appears next to the ticket count badge on the Planned, Lead Coder, Coder, and Reviewed columns (not on New). Additionally, the default drag-and-drop mode should be a configurable property on each custom agent, defaulting to `cli` but overridable to `prompt`.

## User Review Required
> [!NOTE]
> - This changes the default drag-and-drop behaviour **per column**. Existing users who rely on the global "CLI Triggers" toggle will still see that toggle function as before; the per-column mode acts as a secondary filter on top of the global toggle.
> - Custom agents created before this change will default to `cli` mode. No migration is required.
> - **Clarification**: The global `CLI Triggers` toggle remains. When global CLI triggers are OFF, all columns behave as visual-move-only regardless of per-column mode. The per-column mode only takes effect when global CLI triggers are ON.

## Complexity Audit

### Band A — Routine
- **Add `dragDropMode` field to `CustomAgentConfig`** in `src/services/agentConfig.ts` — additive string field with default `'cli'`.
- **Add `dragDropMode` field to `KanbanColumnDefinition`** in `src/services/agentConfig.ts` — propagated from agent config or hardcoded default for built-in columns.
- **Persist per-column overrides** in VS Code `workspaceState` via `KanbanProvider` — simple key-value storage, same pattern as `kanban.cliTriggersEnabled`.
- **Webview JS state tracking** — add a `columnDragDropModes` map, receive it via `postMessage`, update on toggle.
- **CSS for mode toggle icons** — two small icon buttons (CLI / Clipboard) styled identically to existing `.column-icon-btn`.

### Band B — Complex / Risky
- **Bifurcated drop handler logic** — `handleDrop()` in `kanban.html` must inspect the target column's mode and send either `triggerAction` (CLI) or a new `promptOnDrop` message (copy-to-clipboard + visual advance). Incorrect branching could silently lose dispatches or double-fire.
- **New `promptOnDrop` backend message handler** in `KanbanProvider._handleMessage()` — must replicate the prompt-generation and visual-advance logic of `promptSelected` but for a single card arriving via drag-and-drop. Must correctly handle the `PLAN REVIEWED` complexity-routing special case.
- **Custom agent default propagation** — when `buildKanbanColumns()` constructs column definitions, the custom agent's `dragDropMode` must be carried through to `KanbanColumnDefinition` and then to the webview. A mismatch between the persisted override and the agent's compiled default could cause stale UI state.

## Edge-Case & Dependency Audit
- **Race Conditions:** A user could toggle the mode while a drag is in-flight. Since the toggle updates JS state synchronously and the drop handler reads it at drop time (after the 350ms animation delay), this is safe — the mode at drop time wins.
- **Security:** No new user input vectors. Mode is a constrained enum (`'cli'` | `'prompt'`).
- **Side Effects:** The global `CLI Triggers` toggle (`cliTriggersEnabled`) still takes precedence. When OFF, all forward drops use visual-move-only regardless of per-column mode. This must be clearly enforced in the drop handler to prevent accidental CLI triggers.
- **Dependencies & Conflicts:**
  - **Custom Agent Builder plan** (`feature_plan_20260311_083827`): Completed. This plan extends `CustomAgentConfig` with a new field — additive, no conflict.
  - **Kanban Header Adjustments plan** (`feature_plan_20260311_132631`): Completed. Modified column header layout. The mode toggle adds new elements to the header `rightSide` area. Must be placed carefully relative to the existing count badge.
  - **Move All plan** (`feature_plan_20260311_085450`): Completed. Established the autoban/auto-move infrastructure. The per-column mode switch does NOT affect auto-move or autoban behaviour — those always use CLI dispatch. No conflict.

## Adversarial Synthesis

### Grumpy Critique
Oh WONDERFUL. Another layer of per-column state on top of the ALREADY confusing global CLI toggle! Let me count the ways this can go sideways:

1. **State soup**: We now have THREE overlapping dispatch controls: (a) the global `CLI Triggers` toggle, (b) the per-column drag-drop mode, and (c) the existing per-card "Copy Prompt" buttons. The user will have NO idea which one actually fires. What happens when CLI triggers are ON but the column mode is `prompt`? What happens when CLI triggers are OFF and the column mode is `cli`? You better have a crystal-clear precedence rule or support tickets will BURY you.

2. **The `PLAN REVIEWED` special case**: This column does complexity-based routing — dropping a card there fans out to either `LEAD CODED` or `CODER CODED`. If the mode is `prompt`, do we generate a LEAD prompt or a CODER prompt? The existing `promptSelected` handler calls `_partitionByComplexityRoute` and generates separate prompts per role. For a single-card drop, that's fine — but what about multi-card drag-and-drop where some cards route to Lead and some to Coder? You'd need to generate TWO clipboard payloads, which is impossible with a single clipboard write!

3. **Persistence layering**: You're storing per-column overrides in `workspaceState` AND custom agent defaults in `state.json`. What happens when the user changes the custom agent's default in setup? Does it reset the per-column override? Or does the override silently win forever? You need a merge strategy or this will be a ghost bug.

4. **The "Reviewed" column**: The plan says "Planned, Lead Coder, Coder, and Reviewed columns." But the Reviewed column (`CODE REVIEWED`) is the LAST column — there's no next column to advance to! The existing column button area is already empty for it. What does "copy prompt" even mean for a card dragged INTO the final column? There's no prompt to generate because there's no downstream role.

5. **Visual feedback**: When CLI mode triggers, the user sees terminal output. When prompt mode triggers, the user sees... nothing? A tiny toast? The clipboard write is invisible. Users will drag cards and think nothing happened. You NEED prominent visual feedback — a flash animation, a toast, SOMETHING.

### Balanced Response
Grumpy raises valid concerns. Here is how the implementation addresses each:

1. **State precedence** is strictly defined: Global `cliTriggersEnabled` is the master gate. When OFF, all forward drops are visual-move-only (no CLI, no prompt copy). When ON, the per-column `dragDropMode` determines behaviour. The existing per-card "Copy Prompt" buttons are independent and always copy regardless of either toggle. This three-tier model is documented in the `handleDrop()` logic with clear comments.

2. **`PLAN REVIEWED` complexity routing**: For `prompt` mode on this column, we reuse `_generatePromptForColumn()` which already handles complexity partitioning by generating a single batch prompt covering all cards (the prompt itself contains per-plan routing instructions). The clipboard gets one prompt — the same one `promptAll` generates today. No dual-clipboard issue.

3. **Persistence merge strategy**: Per-column overrides stored in `workspaceState` take precedence over the compiled default from `CustomAgentConfig`. When a custom agent's `dragDropMode` default changes, it only affects columns that have NOT been manually overridden. The webview receives the merged effective mode. This is the same pattern used for `visibleAgents`.

4. **Reviewed column**: Correct — `CODE REVIEWED` has no downstream stage. The mode toggle is NOT shown on the last column (matching the existing pattern where the column button area is empty). The plan scope is adjusted to: Planned, Lead Coder, Coder, and any custom agent columns that are not the final column.

5. **Visual feedback**: When `prompt` mode fires on drop, the card receives the same `card-dropped` animation, AND the column count badge briefly flashes green with "Copied!" text (same pattern as the per-card copy button feedback). A VS Code information toast is also shown.

## Proposed Changes

> [!IMPORTANT]
> **MAXIMUM DETAIL REQUIRED:** Complete implementation steps with exact file paths and logic breakdowns.

### 1. Custom Agent Config Schema
#### [MODIFY] `src/services/agentConfig.ts`
- **Context:** The `CustomAgentConfig` interface defines the data model for user-created agents. We add a `dragDropMode` field so users can set the default behaviour for their custom agent's Kanban column. The `KanbanColumnDefinition` interface also needs this field so the webview knows each column's effective mode.
- **Logic:**
  1. Add `dragDropMode: 'cli' | 'prompt'` to `CustomAgentConfig` interface, defaulting to `'cli'` in `parseCustomAgents()`.
  2. Add `dragDropMode: 'cli' | 'prompt'` to `KanbanColumnDefinition` interface.
  3. In `buildKanbanColumns()`, set `dragDropMode: 'cli'` on all `DEFAULT_KANBAN_COLUMNS` entries and propagate `agent.dragDropMode` for custom columns.
- **Implementation:**
  ```typescript
  // In CustomAgentConfig interface, add:
  dragDropMode: 'cli' | 'prompt';

  // In KanbanColumnDefinition interface, add:
  dragDropMode: 'cli' | 'prompt';

  // In DEFAULT_KANBAN_COLUMNS, add to each entry:
  dragDropMode: 'cli' as const,

  // In parseCustomAgents(), when building each agent object:
  dragDropMode: (source.dragDropMode === 'prompt' ? 'prompt' : 'cli') as 'cli' | 'prompt',

  // In buildKanbanColumns(), custom column map:
  dragDropMode: agent.dragDropMode,
  ```
- **Edge Cases Handled:** Invalid `dragDropMode` values in persisted JSON (e.g. typos, `null`) fall through to `'cli'` default via the ternary guard.

### 2. Backend — Per-Column Mode State & New Message Handler
#### [MODIFY] `src/services/KanbanProvider.ts`
- **Context:** The KanbanProvider manages the Kanban webview panel and handles all messages from it. We need to:
  (a) Store per-column drag-drop mode overrides in `workspaceState`.
  (b) Send effective modes to the webview on refresh.
  (c) Handle a new `setColumnDragDropMode` message to persist user toggles.
  (d) Handle a new `promptOnDrop` message that copies the prompt to clipboard and advances the card visually (same as `promptSelected` but triggered by drag-and-drop).
- **Logic:**
  1. Add a private field `_columnDragDropModes: Record<string, 'cli' | 'prompt'>` initialized from `workspaceState.get('kanban.columnDragDropModes', {})`.
  2. In `_refreshBoardImpl()`, after building `columns`, merge persisted overrides onto the column definitions' `dragDropMode` to compute effective modes, then `postMessage({ type: 'updateColumnDragDropModes', modes })` to the webview.
  3. Add case `'setColumnDragDropMode'` in `_handleMessage()`: updates `_columnDragDropModes[msg.columnId]`, persists to `workspaceState`, and posts the updated modes back to the webview.
  4. Add case `'promptOnDrop'` in `_handleMessage()`: functionally identical to the existing `'promptSelected'` handler but accepts `{ sessionId, sourceColumn, targetColumn }` from a drag-and-drop event. Generates the prompt for the target column's role, writes to clipboard, advances the card visually, and posts a `'promptOnDropResult'` message back for visual feedback.
- **Implementation detail for `promptOnDrop`:**
  ```
  1. Resolve workspaceRoot
  2. Refresh board to get latest cards
  3. Find the card by sessionId in _lastCards
  4. Generate prompt: call _generatePromptForColumn([card], sourceColumn, workspaceRoot)
     (uses sourceColumn because the prompt role is based on WHERE the card came FROM,
      i.e. what stage it's completing — same as the existing promptSelected logic)
  5. Write prompt to clipboard via vscode.env.clipboard.writeText()
  6. Advance card visually: determine nextCol via _getNextColumnId() or use targetColumn
     - For PLAN REVIEWED: use _partitionByComplexityRoute for visual move target
     - For others: use targetColumn directly
  7. Execute 'switchboard.kanbanForwardMove' for visual advance
  8. Refresh board
  9. Post { type: 'promptOnDropResult', sessionId, success: true } to webview
  ```
- **Edge Cases Handled:**
  - If the card is no longer found (race with completion), bail with a warning toast.
  - `PLAN REVIEWED` complexity routing is handled identically to existing `promptSelected`.

### 3. Webview — Mode Toggle UI & Bifurcated Drop Handler
#### [MODIFY] `src/webview/kanban.html`
- **Context:** The Kanban webview renders column headers and handles drag-and-drop via JS event listeners. We need to add a mode toggle in each column header and modify `handleDrop()` to check the mode.
- **Logic:**
  1. **JS state**: Add `let columnDragDropModes = {};` alongside existing state variables.
  2. **Message listener**: Add case `'updateColumnDragDropModes'` to set `columnDragDropModes` from backend and update toggle UI.
  3. **`renderColumns()` changes**: For non-CREATED, non-last columns, add a pair of small toggle icons (terminal icon for CLI, clipboard icon for Prompt) in the column header next to the count badge. The active mode gets the `.is-active` highlight class.
  4. **Toggle click handler**: On click, toggle between `'cli'` and `'prompt'`, update local `columnDragDropModes[col]`, send `{ type: 'setColumnDragDropMode', columnId: col, mode: newMode }` to backend, and update the icon highlight.
  5. **`handleDrop()` changes**: After the existing forward/backward partitioning, in the forward-move branch:
     - If `!cliTriggersEnabled`: use visual-move-only (existing behaviour, unchanged).
     - Else if `columnDragDropModes[targetColumn] === 'prompt'`: send `{ type: 'promptOnDrop', sessionId, sourceColumn: card.column, targetColumn }` instead of `triggerAction`.
     - Else: send `triggerAction` (existing CLI behaviour, unchanged).
  6. **Visual feedback for prompt mode**: On receiving `'promptOnDropResult'`, flash the target column's count badge green and show "Copied!" text briefly (reuse the `copyPlanLinkResult` feedback pattern).
- **CSS additions:**
  ```css
  .mode-toggle-group {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      margin-right: 6px;
  }
  .mode-toggle-btn {
      background: transparent;
      border: 1px solid transparent;
      cursor: pointer;
      padding: 2px;
      border-radius: 2px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s;
      opacity: 0.4;
  }
  .mode-toggle-btn:hover {
      opacity: 0.7;
  }
  .mode-toggle-btn.is-active {
      opacity: 1;
      color: var(--accent-teal);
      border-color: var(--accent-teal-dim);
  }
  ```
- **HTML for mode toggle** (SVG icons inline, no external assets needed):
  - CLI icon: small terminal/command-prompt SVG
  - Prompt icon: small clipboard SVG
- **Edge Cases Handled:**
  - Multi-card drag in prompt mode: all forward cards generate a single batch prompt via `promptOnDrop` with multiple session IDs (extend the message to accept `sessionIds: string[]`).
  - Backward moves are unaffected by mode — they always use `moveCardBackwards`.

### 4. Custom Agent Setup UI
#### [MODIFY] `src/webview/implementation.html` (or the setup webview that renders the custom agent modal)
- **Context:** The custom agent builder modal already has fields for name, startup command, prompt instructions, kanban inclusion, and kanban order. We add a "Drag & Drop Default" dropdown.
- **Logic:**
  1. Add a `<select>` element with two options: `CLI Trigger` (value `cli`) and `Copy Prompt` (value `prompt`).
  2. Pre-populate from the agent's `dragDropMode` when editing.
  3. Include in the save payload sent to the backend.
- **Edge Cases Handled:** Missing field on legacy agents defaults to `'cli'` via `parseCustomAgents()`.

## Verification Plan

### Automated Tests
- **`src/services/__tests__/kanbanColumnDerivation.test.ts`**: No changes needed (column derivation logic is unchanged).
- **New unit tests for `agentConfig.ts`**:
  - `parseCustomAgents()` returns `dragDropMode: 'cli'` when field is missing.
  - `parseCustomAgents()` returns `dragDropMode: 'prompt'` when explicitly set.
  - `parseCustomAgents()` returns `dragDropMode: 'cli'` for invalid values (e.g. `'banana'`).
  - `buildKanbanColumns()` propagates `dragDropMode` from custom agents.
- **TypeScript compilation**: `npx tsc -p . --noEmit` must pass.
- **Webpack build**: `npm run compile` must succeed.

### Manual Testing
1. Open CLI-BAN. Verify mode toggle icons appear on Planned, Lead Coder, Coder columns (and any custom agent columns). Verify they do NOT appear on New or the last column (Reviewed).
2. Default state: all built-in columns show CLI mode active.
3. Click the clipboard icon on the Planned column. Verify it switches to prompt mode (clipboard icon highlighted, terminal icon dimmed).
4. Drag a card into the Planned column. Verify the prompt is copied to clipboard (paste into a text editor to confirm) and the card advances visually WITHOUT triggering a CLI terminal.
5. Toggle global CLI Triggers OFF. Drag a card forward. Verify visual-move-only regardless of per-column mode.
6. Toggle global CLI Triggers ON. Switch a column back to CLI mode. Drag a card. Verify CLI agent fires.
7. Create a custom agent with `dragDropMode: 'prompt'`. Verify its Kanban column defaults to prompt mode.
8. Close and reopen the Kanban panel. Verify per-column modes are persisted.

## Open Questions
- **Resolved:** Should the global CLI Triggers toggle interact with per-column mode? → Yes, global OFF overrides everything to visual-move-only.
- **Resolved:** What about the Reviewed (last) column? → No toggle shown; it has no downstream stage.

## Recommended Agent
**Send to Lead Coder** — Band B tasks involve bifurcated dispatch logic in the webview drop handler and a new backend message handler with complexity-routing edge cases.

---

## Post-Implementation Review (2026-03-21)

### Grumpy Principal Engineer Findings

| # | Severity | Finding | Location |
|---|----------|---------|----------|
| 1 | **CRITICAL** | Duplicate `case 'updateColumnDragDropModes'` in webview message listener — first handler (blunt full re-render) shadows second handler (targeted DOM updates), making the targeted handler dead code | `src/webview/kanban.html` lines 1513–1518 vs 1527–1546 |
| 2 | **MAJOR** | `promptOnDrop` handler fires pair programming CLI dispatch for low-complexity cards even in prompt mode, violating the user's explicit opt-out of CLI triggers | `src/services/KanbanProvider.ts` lines 1195–1198 |
| 3 | **MAJOR** | No unit tests created for `dragDropMode` in `parseCustomAgents()` and `buildKanbanColumns()`, despite plan's Verification section mandating four specific test cases | Missing test file |
| 4 | NIT | Mode toggle click triggers full DOM re-render (`renderColumns()` + `renderBoard()`) instead of targeted icon swap | `src/webview/kanban.html` |
| 5 | NIT | `ICON_PROMPT` reuses same image as `ICON_PROMPT_SELECTED` — minor visual ambiguity | `src/webview/kanban.html` / `src/services/KanbanProvider.ts` |

### Balanced Synthesis

- **Finding 1 (CRITICAL):** Fixed — removed the first duplicate handler; the targeted handler is now the sole match.
- **Finding 2 (MAJOR):** Fixed — removed pair programming dispatch from `promptOnDrop` handler entirely. Prompt mode now suppresses all CLI dispatches. Pair programming only fires via CLI-mode drops.
- **Finding 3 (MAJOR):** Fixed — created `src/test/agent-config-drag-drop-mode.test.js` with 8 test cases covering all plan-required scenarios.
- **Finding 4 (NIT):** Deferred — full re-render is functionally correct, optimization can come later.
- **Finding 5 (NIT):** Deferred — cosmetic, no functional impact.

### Files Changed During Review

| File | Change |
|------|--------|
| `src/webview/kanban.html` | Removed duplicate `case 'updateColumnDragDropModes'` (lines 1513–1518) |
| `src/services/KanbanProvider.ts` | Removed pair programming CLI dispatch from `promptOnDrop` handler |
| `src/test/agent-config-drag-drop-mode.test.js` | **New** — 8 unit tests for `dragDropMode` parsing and propagation |

### Validation Results

- **TypeScript compilation** (`npx tsc -p . --noEmit`): ✅ Pass — zero errors
- **Webpack build** (`npm run compile`): ✅ Pass — compiled successfully
- **New unit tests** (`npx mocha src/test/agent-config-drag-drop-mode.test.js`): ✅ 8/8 passing
- **Full test suite**: Pre-existing failures in coder-reviewer workflow regression tests (unrelated to this feature); all other tests pass

### Remaining Risks

- **Manual testing required:** The webview UI (mode toggle icons, drag-drop bifurcation, visual feedback on prompt-mode drop) cannot be fully verified by automated tests — requires manual Kanban board interaction per the Manual Testing checklist in the Verification Plan.
- **Stale persisted overrides:** If a custom agent's `dragDropMode` default changes after a user has manually overridden the column mode, the override silently wins. This is documented behaviour (same pattern as `visibleAgents`) but could surprise users. Consider adding a "reset to default" option in a future iteration.
