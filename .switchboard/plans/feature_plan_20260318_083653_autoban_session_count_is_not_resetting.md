# Autoban session count is not resetting

## Goal
After stopping an autoban session, the session count is still showing as '28/200'. If this persists like this, it will mean the autoban will eventually refuse to start. The session count needs to be reset whenever the autoban stops, either automatically or manually.

## Proposed Changes

### Root Cause (Confirmed via code inspection)

The `_resetAutobanSessionCounters()` method exists at `TaskViewerProvider.ts` line 1468 and correctly resets `sessionSendCount`, `sendCounts`, and `poolCursor`. However, it is **only called on START** (lines 2119, 2183, 2999 — when `enabled` transitions from false→true), **never on STOP**.

The `_stopAutobanWithMessage()` method (lines 1822–1835) sets `enabled: false`, calls `_stopAutobanEngine()`, persists state, and broadcasts — but does NOT call `_resetAutobanSessionCounters()`. This means:
- Session count persists across stop/start cycles.
- If the count was 28/200 when stopped, it remains 28/200 in persisted state.
- On next START, `_resetAutobanSessionCounters()` IS called — so the count resets to 0/200.

**Wait — the reset IS called on start.** So why does the user see stale counts?

**Deeper investigation:** The UI display (`implementation.html` line 3050) reads from `autobanState.sessionSendCount`. The state is broadcast via `_postAutobanState()`. After stopping, the last broadcast still contains the old count. The sidebar shows the **stopped** state with the old count until the user re-enters the Autoban tab or the sidebar re-renders.

**The real bug:** The count should visually reset immediately when autoban stops, not wait for the next start. The user sees "28/200" in a stopped state and worries it will accumulate.

### Step 1: Reset session counters on stop
**File:** `src/services/TaskViewerProvider.ts` — `_stopAutobanWithMessage()` (lines 1822–1835)

Add `_resetAutobanSessionCounters()` before persisting state:

```typescript
private async _stopAutobanWithMessage(message: string, level: 'info' | 'warning' = 'warning'): Promise<void> {
    this._autobanState = normalizeAutobanConfigState({
        ...this._autobanState,
        enabled: false
    });
    this._stopAutobanEngine();
    this._resetAutobanSessionCounters();  // ← ADD THIS LINE
    await this._persistAutobanState();
    this._postAutobanState();
    if (level === 'info') {
        vscode.window.showInformationMessage(message);
        return;
    }
    vscode.window.showWarningMessage(message);
}
```

This ensures:
1. The persisted state has `sessionSendCount: 0` after stop.
2. The UI broadcast shows "SESSION 0/200" immediately.
3. No stale count lingers across stop/start cycles.

### Step 2: Verify the on-start reset is still correct
**File:** `src/services/TaskViewerProvider.ts` — lines 2183, 2999

The existing reset-on-start calls should remain as a safety net (defense in depth). If for any reason the stop-reset is missed (e.g., crash), the start-reset will still clear the counters.

### Step 3: Verify UI display updates immediately on stop
**File:** `src/webview/implementation.html` — line 3050

The session count badge (`sessionCapBadge.textContent`) is updated when `autobanStateSync` messages arrive. Since `_postAutobanState()` is called after the reset in Step 1, the UI will receive the zeroed state. No UI changes needed.

## Verification Plan
- Start autoban, let it dispatch a few plans (count increments to e.g., 5/200).
- Stop autoban.
- Confirm the session count immediately shows "SESSION 0/200" (not stuck at "5/200").
- Start autoban again, confirm count starts from 0.
- Let autoban hit the session cap (200/200), confirm it auto-stops.
- Confirm count resets to 0/200 after the auto-stop.

## Open Questions
- Should there be a "total lifetime dispatches" counter that persists across sessions for analytics, separate from the session counter?

## Complexity Audit
**Band A (Routine)**
- Single-line addition in a single file (`TaskViewerProvider.ts`).
- Reuses an existing method (`_resetAutobanSessionCounters`).
- No new patterns, no UI changes, no schema changes.
- Very low risk.

## Dependencies
- **Related to:** `feature_plan_20260317_154731_autoban_bugs.md` — that plan fixes autoban dispatch logic. The session count bug is independent but affects the same autoban state. No ordering conflict — can be implemented in either order.
- **Related to:** `feature_plan_20260317_165224_autoban_should_stop_when_no_more_valid_tickets.md` — that plan adds another auto-stop trigger. The fix here (reset on stop) applies to ALL stop paths, including the new one.
- No conflicts.

## Adversarial Review

### Grumpy Critique
1. "If the count resets on stop, the user loses visibility into how many plans were dispatched in the last session. That's useful information for debugging."
2. "Double-resetting (on stop AND on start) means the reset logic is duplicated. What if they get out of sync?"

### Balanced Synthesis
1. **Valid — add a log message before resetting.** Log the final count to the output channel: `outputChannel.appendLine(`Autoban stopped: ${count} plans dispatched this session.`)` This preserves the information without keeping it in the UI.
2. **Mild concern — but defense in depth is standard practice.** The start-reset is a safety net. Both paths call the same `_resetAutobanSessionCounters()` method, so there's no sync risk.

## Agent Recommendation
**Coder** — One-line fix in a well-understood method. Minimal risk.
