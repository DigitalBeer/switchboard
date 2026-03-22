# Pair Programming: Two-Stage Clipboard Mode

## Goal
When the user clicks the **Pair** button on a high-complexity card and the **Coder column is set to `prompt` mode**, replace the existing Coder terminal dispatch with a **two-stage clipboard notification flow**. The Lead prompt is copied to the clipboard immediately (as today), and the Coder prompt is offered via a persistent VS Code notification action button that the user can click at their leisure to swap the clipboard contents.

This enables a fully manual, zero-CLI pair programming workflow — ideal for IDEs like Windsurf where the user prefers paste-based interactions over CLI terminal dispatch.

## User Review Required
> [!NOTE]
> - This feature is **opt-in by configuration**: it only activates when the user has both (a) pair programming enabled and (b) the Coder column's drag-and-drop mode set to `prompt`. No existing behaviour changes for users who haven't configured this combination.
> - The existing Pair button behaviour (Lead → clipboard, Coder → CLI terminal) remains the default when the Coder column is in `cli` mode.
> - This does NOT affect drag-and-drop pair programming (Mode 1: drag high-complexity card to LEAD CODED in CLI mode fires both terminals). That path always uses CLI dispatch regardless of Coder column mode.

## Context: Three Pair Programming Modes

| # | Trigger | Coder Column Mode | Lead Dispatch | Coder Dispatch |
|---|---------|-------------------|---------------|----------------|
| 1 | Drag-drop / Move buttons (CLI mode) | `cli` | CLI terminal | CLI terminal |
| 2 | Pair button | `cli` (default) | Clipboard → IDE chat | CLI terminal |
| **3** | **Pair button** | **`prompt`** | **Clipboard → IDE chat** | **Two-stage clipboard notification** |

Mode 3 is the scope of this plan. Modes 1 and 2 are already implemented.

## UX Flow (Mode 3)

1. User clicks **Pair** on a high-complexity PLAN REVIEWED card
2. **Stage 1**: Lead prompt is copied to clipboard immediately
3. VS Code shows a persistent information notification:
   > *"Lead prompt copied to clipboard. Paste to IDE chat, then click below for Coder prompt."*
   > **[Copy Coder Prompt]**
4. User pastes Lead prompt into IDE chat window, Lead Coder works
5. **Stage 2**: User clicks **Copy Coder Prompt** button on the notification
6. Coder prompt replaces clipboard contents. Confirmation notification:
   > *"Coder prompt copied to clipboard."*
7. User pastes Coder prompt into a second chat window (or the same one after Lead finishes)
8. Card advances to LEAD CODED (same as current Pair button behaviour)

### Why Not Handoff-Chat?
The handoff-chat workflow requires the Lead agent to prepare a plan itself, consuming tokens. The two-stage clipboard approach pre-generates both prompts from the plan file at button-click time — **zero extra tokens**. This aligns with pair programming's goal of efficient parallel dispatch.

## Complexity Audit

### Band A — Routine
- **Read Coder column's effective `dragDropMode`** — look up `this._columnDragDropModes['CODER CODED']` with fallback to the column definition's default. Same pattern already used in `_refreshBoardImpl()`.
- **Card advance** — unchanged, still calls `switchboard.kanbanForwardMove` to LEAD CODED.
- **Update README.md** — replace the existing Pair Programming section with a full description of all three modes, including setup instructions for Mode 3. This is the primary discoverability surface for the feature.

### Band B — Complex / Risky
- **Bifurcated Pair button handler** — `pairProgramCard` case in `KanbanProvider._handleMessage()` must check the Coder column's effective mode and branch between CLI dispatch and the two-stage notification flow. Incorrect branching could silently lose the Coder dispatch.
- **Notification lifetime** — `vscode.window.showInformationMessage` with action items returns a `Thenable`. If the user dismisses without clicking, the Coder prompt is lost. Need to handle this gracefully (log or show a secondary fallback).

## Implementation Steps

### Step 1: Resolve effective Coder column mode (Band A)

**File:** `src/services/KanbanProvider.ts`

In the `pairProgramCard` handler, after building both prompts, resolve the effective drag-drop mode for the Coder column:

```typescript
// Resolve effective Coder column mode
const coderColumnId = 'CODER CODED';
const coderColumnMode = this._columnDragDropModes[coderColumnId] || 'cli';
```

### Step 2: Bifurcate Coder dispatch (Band B)

**File:** `src/services/KanbanProvider.ts`

Replace the current unconditional `dispatchToCoderTerminal` call with a mode-aware branch:

```typescript
if (coderColumnMode === 'prompt') {
    // Mode 3: Two-stage clipboard — Lead prompt first, Coder prompt on demand
    await vscode.env.clipboard.writeText(leadPrompt);

    const choice = await vscode.window.showInformationMessage(
        'Lead prompt copied. Paste to IDE chat, then click below for Coder prompt.',
        'Copy Coder Prompt'
    );
    if (choice === 'Copy Coder Prompt') {
        await vscode.env.clipboard.writeText(coderPrompt);
        vscode.window.showInformationMessage('Coder prompt copied to clipboard.');
    } else {
        // User dismissed — log for visibility but don't block
        console.log('[KanbanProvider] Pair programming: user dismissed Coder prompt notification.');
    }
} else {
    // Mode 2: Lead prompt to clipboard, Coder prompt to terminal
    await vscode.env.clipboard.writeText(leadPrompt);
    vscode.window.showInformationMessage('Band B prompt copied to clipboard. Dispatching Band A to Coder terminal...');
    await vscode.commands.executeCommand('switchboard.dispatchToCoderTerminal', coderPrompt);
}
```

### Step 3: Card advance (unchanged)

The card advance to LEAD CODED remains the same regardless of mode — it happens after the dispatch/clipboard stage.

### Step 4: Update README.md (Band A)

**File:** `README.md`

Replace the existing `### Pair Programming Mode` section (lines 59–62) with a comprehensive description of all three modes:

```markdown
### Pair Programming Mode

Pair programming splits high-complexity plans into two streams: Lead Coder handles the complex work, while a cheaper Coder agent (e.g. Gemini Flash) handles the boilerplate simultaneously. This can reduce your primary IDE agent quota by up to 50%.

Enable pair programming with the **Pair Programming** toggle at the top of the CLI-BAN. There are three ways it works, depending on your setup:

| Mode | How to trigger | Lead gets | Coder gets |
| :--- | :--- | :--- | :--- |
| **CLI Parallel** | Drag a high-complexity card to Lead Coder column (Coder column in CLI mode) | CLI terminal dispatch | CLI terminal dispatch |
| **Hybrid** | Click the **Pair** button on a card (Coder column in CLI mode) | Clipboard prompt → paste to IDE chat | CLI terminal dispatch |
| **Full Clipboard** | Click the **Pair** button on a card (Coder column in Prompt mode) | Clipboard prompt → paste to IDE chat | Notification button → clipboard prompt |

**CLI Parallel** is the default — both agents fire automatically in separate terminals. **Hybrid** is for when you want to use your IDE chat (Windsurf, Antigravity) for the complex work while a CLI agent handles the easy parts. **Full Clipboard** is for IDEs where you prefer pasting all prompts manually — click the notification button when you're ready for the Coder prompt.

To set up Full Clipboard mode: set the Coder column's drag-and-drop mode to **Prompt** using the toggle icon in the column header, then click the **Pair** button on any high-complexity card.
```

## Edge-Case & Dependency Audit

- **Notification dismissed without clicking**: The Coder prompt is lost. This is acceptable — the user explicitly dismissed it. A `console.log` records the event. The user can always re-trigger by clicking Pair again (the card is still in PLAN REVIEWED until advanced, though in this flow it advances immediately — so the user would need to move it back). **Mitigation**: Consider adding a second action button "Dismiss" to make the choice explicit, or keep the Coder prompt in a recoverable location (e.g., write to `.switchboard/handoff/` as a backup).
- **Race with clipboard**: If the user copies something else between Stage 1 and Stage 2, the Lead prompt is overwritten. This is expected user behaviour — the notification button replaces clipboard again at Stage 2.
- **Coder column mode changes mid-flow**: If the user toggles the Coder column mode between clicking Pair and the notification resolving, the mode was already read at click time. The notification flow continues as initiated. This is correct — the user's intent was established at click time.
- **Dependencies:**
  - **Drag and Drop Mode Switch plan** (`feature_plan_20260321_213109`): Must be implemented first — provides the `_columnDragDropModes` state and per-column `dragDropMode` infrastructure.
  - **Pair Programming feature**: Existing. No conflict — this extends the Pair button's behaviour, doesn't replace it.

## Adversarial Synthesis

### Grumpy Critique
Oh FANTASTIC, yet another modal branching path hidden behind a combination of TWO separate toggles that the user has to discover by accident. Let me enumerate the failure modes:

1. **Discoverability is zero.** The user has to: (a) enable pair programming, (b) set the Coder column to prompt mode, (c) click the Pair button on a high-complexity card. There is NO indication anywhere that this combination produces different behaviour. The Pair button looks identical. No tooltip change. No visual cue. The user will either never find this or be CONFUSED when the behaviour differs from their expectation. *(See mitigation below.)*

2. **Notification fatigue.** VS Code notifications stack and users compulsively dismiss them. The Coder prompt disappears forever if dismissed. You're betting the entire Coder dispatch on a notification button that users have been trained to ignore.

3. **The card advances immediately.** If the user dismisses the notification (accidentally or otherwise), the card is already in LEAD CODED. There's no way to re-trigger the Coder prompt without moving the card back. That's a one-way data loss.

### Balanced Response
1. **Discoverability** — Valid concern. **Fix**: (a) Update the Pair button tooltip when Coder column is in prompt mode to say "Pair (clipboard relay)" instead of "Pair". (b) Document all three pair programming modes comprehensively in the project README.md (Step 4) — this is the primary discovery surface for new users and serves as the reference for the feature's behaviour matrix.
2. **Notification dismissal** — Valid concern. **Mitigate**: Write the Coder prompt to `.switchboard/handoff/coder_prompt_<sessionId>.md` as a backup, and include the file path in the console log. The notification is the primary UX, but the file is a safety net.
3. **Card advance timing** — Valid but acceptable trade-off. The card advance happens in all Pair modes. Moving the advance to AFTER the notification resolves would delay the board update unnecessarily. The backup file (from point 2) covers the recovery case.

## Verification Plan

### Automated Tests
- **TypeScript compilation**: `npx tsc -p . --noEmit` must pass.
- **Webpack build**: `npm run compile` must succeed.
- No new unit tests required (the logic is a simple branch on an existing enum value in a VS Code API-dependent handler).

### Manual Testing
1. Set Coder column to `prompt` mode. Enable pair programming. Click Pair on a high-complexity PLAN REVIEWED card.
2. Verify Lead prompt is copied to clipboard immediately.
3. Verify notification appears with "Copy Coder Prompt" button.
4. Click the button. Verify clipboard now contains the Coder prompt (paste into editor to confirm).
5. Repeat, but dismiss the notification instead. Verify console log message appears. Verify backup file exists in `.switchboard/handoff/`.
6. With Coder column in `cli` mode, click Pair. Verify existing behaviour (Lead → clipboard, Coder → terminal) is unchanged.
7. With pair programming disabled, click Pair. Verify Pair button is not available / no dispatch occurs.

## Open Questions
- **Resolved:** Should Mode 3 also fire on drag-and-drop? → No. Drag-and-drop pair programming (Mode 1) is always CLI-based. Mode 3 only applies to the explicit Pair button, which is inherently a manual/IDE-chat workflow.
- **Open:** Should the backup file in `.switchboard/handoff/` be cleaned up automatically after the user clicks the notification button? Or left for reference?

## Recommended Agent
**Send to Lead Coder** — The bifurcated handler logic in `pairProgramCard` is a Band B task involving async notification flows and fallback file writes.
