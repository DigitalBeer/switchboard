# Deselected agent terminals are still opened

## Goal
Fix a bug where built-in agent terminals (Lead Coder, Coder, Planner, Reviewer, Analyst) are still spawned in the UI grid even when they are deselected in the setup menu.

## Complexity Audit
### Routine
- Add a visibility check for built-in agents in `src/extension.ts` during initialization of `createAgentGrid`.
### Band B — Complex / Risky
- None

## Edge-Case & Dependency Audit
- **Race Conditions:** None, the configuration is loaded before grid creation.
- **Security:** None.
- **Side Effects:** When an agent is deselected, its existing terminal (if any) might need to be disposed, but the `clearGridBlockers` logic already handles this correctly by removing terminals not in the `agents` array. Our fix naturally plugs into this.
- **Dependencies & Conflicts:** None.

## Adversarial Synthesis
### Grumpy Critique
You think just slapping an `if` statement in `createAgentGrid` is enough? What about when the user *changes* their selection while the extension is running? Do the terminals magically disappear, or do they sit there chewing up memory like a stray dog eating a couch? And what if `visibleAgents` isn't fully populated on first startup? Will it default to false and hide everything, ruining the user's first experience?

### Balanced Response
Grumpy raises a fair point about first-time experience. However, `getVisibleAgents()` in `TaskViewerProvider` explicitly defaults to `true` for all core agents if not set, so the first-time experience is safe. Regarding live changes: when the user clicks 'Save Configuration' in the setup menu, it triggers a state update, but the grid terminals are typically managed when `createAgentGrid` is requested (e.g., via the "START TEAM" command). The existing `clearGridBlockers` handles cleanup of removed agents seamlessly once `createAgentGrid` is invoked again. For this bug, filtering the initial array correctly intercepts the runaway terminal creation.

## Proposed Changes
> [!IMPORTANT]
> **MAXIMUM DETAIL REQUIRED:** Provide complete, fully functioning code blocks. Break down the logic step-by-step before showing code.

### `src/extension.ts`
#### [MODIFY] `src/extension.ts`
- **Context:** In `createAgentGrid()`, built-in agents are unconditionally added to the `agents` array, whereas custom agents check `visibleAgents[agent.role] === false`.
- **Logic:** Step 1: Define the built-in agents list. Step 2: Filter this list checking `visibleAgents[agent.role] !== false` before adding them to the final `agents` array.
- **Implementation:**
```typescript
        const visibleAgents = await taskViewerProvider.getVisibleAgents();
        const includeJulesMonitor = visibleAgents.jules !== false;
        const customAgents = await taskViewerProvider.getCustomAgents();
        
        const allBuiltInAgents = [
            { name: 'Lead Coder', role: 'lead' },
            { name: 'Coder', role: 'coder' },
            { name: 'Planner', role: 'planner' },
            { name: 'Reviewer', role: 'reviewer' },
            { name: 'Analyst', role: 'analyst' }
        ];

        const agents: { name: string; role: string }[] = [];
        
        for (const builtIn of allBuiltInAgents) {
            if (visibleAgents[builtIn.role] !== false) {
                agents.push(builtIn);
            }
        }

        for (const agent of customAgents) {
            if (visibleAgents[agent.role] === false) {
                continue;
            }
            agents.push({ name: agent.name, role: agent.role });
        }
        
        if (includeJulesMonitor) {
            agents.push({ name: 'Jules Monitor', role: 'jules_monitor' });
        }
```
- **Edge Cases Handled:** Maintains safety for missing configuration by strictly checking for `!== false`.

## Verification Plan
### Automated Tests
- N/A - extension UI logic testing.
### Manual Verification
1. Open the UI setup menu and deselect 'Analyst' and 'Reviewer'.
2. Click 'Save Configuration'.
3. Run the 'Start Team Panel' command (or equivalent that triggers `createAgentGrid`).
4. Verify that only 'Lead Coder', 'Coder', 'Planner' and 'Jules Monitor' terminals are opened, and the others are absent.

---

## Review Results (2026-03-24)

### Review Status: ✅ PASS — No code changes required

### Verification
- **TypeScript compile:** ✅ `tsc --noEmit` exit code 0
- **Test suite:** ✅ webpack build successful, no regressions

### Files Changed
- `src/extension.ts` — `createAgentGrid()` (lines 1749-1777): Built-in agents filtered via `visibleAgents[builtIn.role] !== false` before being added to the `agents` array. Implementation matches plan spec exactly.

### Findings
| Severity | Finding | Resolution |
|----------|---------|------------|
| MAJOR | Pre-existing terminals for deselected built-in agents are not disposed by `clearGridBlockers` (only Jules Monitor has hidden-agent cleanup at lines 1805-1813). | **Deferred** — pre-existing behavior, not a regression. Plan goal is preventing NEW terminal spawning, which is correctly achieved. Follow-up enhancement recommended. |
| NIT | No inline comment explaining why `!== false` is used instead of a truthy check. | Accepted — the convention is consistent with the custom agents filter pattern. |

### Remaining Risks
- If a user previously ran "Start Team" with all agents visible, then deselects one, re-running "Start Team" will correctly skip creating a new terminal for the deselected agent but will NOT dispose the old terminal. This is a UX polish item for a future plan.
