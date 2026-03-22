# Pair programming mode should default to off

## Goal
Pair programming mode should not default to on when the user first loads the extension. 

## User Review Required
> [!NOTE]
> No user-facing breaking changes. Pair Programming mode will just be disabled on startup.

## Complexity Audit
### Band A — Routine
- Explicitly reset `pairProgrammingEnabled` to false during initialization so it isn't persisted across workspace reloads.
### Band B — Complex / Risky
- None

## Edge-Case & Dependency Audit
- **Race Conditions:** None. Initialization happens sequentially before the webview is rendered.
- **Security:** None.
- **Side Effects:** Users who actually want pair programming enabled by default every time they open VS Code will need to turn it on manually each session. This aligns with the requested feature.
- **Dependencies & Conflicts:** None.

## Adversarial Synthesis
### Grumpy Critique
"You're just blindly mutating state after load! If you set `pairProgrammingEnabled = false` right after `normalizeAutobanConfigState`, you're going to overwrite it without persisting the cleared state, meaning the actual workspace state object still has it saved as true on disk! This will cause confusion if they toggle it and the persisted state gets out of sync, though the next persist will fix it. Just set it to false on load and call it a day, but don't act like it's a deep architectural fix."

### Balanced Response
"Grumpy is right that we're overriding persisted state, but that's exactly the goal: we want it off on load regardless of what was saved. We'll set it to false immediately after reading the persisted state in `TaskViewerProvider.ts`. The next time `_persistAutobanState` naturally fires, it will write the `false` back to disk, cleanly dropping the old saved state. This is a simple, effective fix."

## Proposed Changes
> [!IMPORTANT]
> **MAXIMUM DETAIL REQUIRED:** Provide complete, fully functioning code blocks. Break down the logic step-by-step before showing code.

### `src/services/TaskViewerProvider.ts`
#### MODIFY `src/services/TaskViewerProvider.ts`
- **Context:** `TaskViewerProvider` restores the `autobanState` from workspace state. If `pairProgrammingEnabled` was saved as true in a previous session, it restores as true. We must force it to false upon extension load.
- **Logic:** After `normalizeAutobanConfigState` initializes `this._autobanState` from `savedAutoban`, we will explicitly force `pairProgrammingEnabled` to `false`.
- **Implementation:**
```typescript
        // Restore persisted Autoban state
        const savedAutoban = this._context.workspaceState.get<Partial<AutobanConfigState>>('autoban.state');
        this._autobanState = normalizeAutobanConfigState(savedAutoban);
        
        // Ensure pair programming defaults to OFF on load regardless of previous session state
        this._autobanState.pairProgrammingEnabled = false;

        this._setupStateWatcher();
```
- **Edge Cases Handled:** By resetting it directly on the `this._autobanState` object on initialization, we ensure that the webview renders it as `false` when it connects.

## Verification Plan
### Automated Tests
- Reload the extension with `autoban.state` containing `pairProgrammingEnabled: true`. Ensure the UI checkbox renders as unchecked and `TaskViewerProvider.ts` state reads `false`.

## Open Questions
- None

---

## Code Review (2026-03-21)

### Stage 1 — Grumpy Principal Engineer

> "Well, well, well. Someone actually did the ONE thing the plan asked for. I searched high and low for a way to complain about this — checked the initialization order, checked whether `normalizeAutobanConfigState` could somehow re-enable it after the override, checked whether `_postAutobanState` gets called before the webview connects and could re-broadcast a stale `true` — and found... nothing. It's one line. It's in the right place. It does what it says. The persisted state will catch up on the next natural persist cycle. I'm almost *offended* by how boring this is."
>
> **Findings:** None. Zero. Zilch. This is a NIT-free zone.

### Stage 2 — Balanced Synthesis

Implementation matches the plan exactly. The single-line override at `TaskViewerProvider.ts:211` fires after `normalizeAutobanConfigState` and before any webview connection or state broadcast. No code fix needed.

### Files Changed
- None (implementation was correct as-is)

### Validation Results
- `tsc --noEmit`: **PASS** (exit code 0)
- `autoban-state-regression.test.js`: **PASS**
- `autoban-controls-regression.test.js`: **PASS**
- All kanban test suites (9/9): **PASS**

### Remaining Risks
- None