# Kanban Card Links Do Not Work — Session File ENOENT on Cross-Machine Workspaces

## Goal
Eliminate the `ENOENT` crash that occurs when a user clicks a kanban card (review, view, or copy-link) on a machine where the `.switchboard/sessions/sess_*.json` file does not exist on disk. The fix replaces the filesystem-based session lookup in `_resolvePlanContextForSession()` and `_handleCopyPlanLink()` with a KanbanDatabase lookup, which already stores the required `plan_file`, `topic`, and `brain_source_path` columns per session.

**Reproduction:** Create plans on Windows, sync the workspace to macOS (or any scenario where the `.switchboard/sessions/` directory is missing or incomplete), then click any kanban card. The error is:
```
Failed to open review panel: Error: ENOENT: no such file or directory,
open '.switchboard/sessions/sess_1773691232850.json'
```

## User Review Required
> [!NOTE]
> - No breaking changes to user-facing behavior. Cards that currently work (session file present) will continue to work via the filesystem fallback.
> - Cards that previously crashed with ENOENT will now resolve from the database and open correctly.
> - No new dependencies or schema migrations required — the `plans` table and `getPlanBySessionId()` method already exist in `KanbanDatabase.ts`.

## Complexity Audit

**Manual Complexity Override:** Low

### Routine
- Modifying `_resolvePlanContextForSession()` to try the DB first, then fall back to filesystem — straightforward data-source swap with existing API.
- Modifying `_handleCopyPlanLink()` to use the same DB-first pattern — follows the same logic as the shared resolver but was implemented inline.
- Adjusting error messages to reflect the dual-lookup strategy.

### Complex / Risky
- None.


## Edge-Case & Dependency Audit
- **Race Conditions:** None. The DB is read-only in this path (no writes). The SQLite database uses WAL mode, so concurrent reads from the kanban board refresh and card click are safe.
- **Security:** The existing `_isPathWithinRoot()` workspace-boundary check is preserved. Plan file paths resolved from the DB are subject to the same containment validation as those from session files. No new attack surface.
- **Side Effects:** The `_handleCopyPlanLink()` method currently calls `deriveKanbanColumn(sheet.events, customAgents)` when no explicit column is provided. The DB-based path uses the stored `kanbanColumn` field instead. This is actually more correct — it reflects the persisted state rather than re-deriving from a potentially stale events log.
- **Dependencies & Conflicts:**
  - **"Stop session files being created from DB"** plan (`feature_plan_20260326_140012`): Both plans address the session-file-to-DB transition. They do not conflict — that plan stops the *creation* of session files; this plan stops the *reading* of them for card operations. Completing both eliminates session files from the kanban card lifecycle entirely.
  - **KanbanDatabase schema:** No schema changes needed. The `plans` table already has `session_id`, `plan_file`, `topic`, `brain_source_path`, `kanban_column`, and `workspace_id`.

## Adversarial Synthesis
### Grumpy Critique
Oh, *wonderful*. So we built an entire SQLite database layer — complete with indices, WAL mode, the whole works — and then the three most user-visible operations in the entire extension *still read from artisanal hand-crafted JSON files on disk*? That's not technical debt, that's technical denial.

Let me enumerate the ways this is offensive:

1. **`_resolvePlanContextForSession` is a 30-line method whose entire purpose is to do what `getPlanBySessionId()` does in one call.** It reads a JSON file, parses it, extracts `planFile` and `topic`, resolves the path, checks containment — all of which the DB record already provides. This method should have been deleted during the DB migration. Instead it's been sitting here like a loaded footgun waiting for someone to sync their workspace to a second machine.

2. **`_handleCopyPlanLink` duplicates the ENTIRE session-file-read logic** instead of calling `_resolvePlanContextForSession`. Copy-paste engineering at its finest. Now we get to fix the same bug in two places. And it ALSO re-derives the kanban column from the events array — events that are *in the session file that doesn't exist*. The DB already stores the column. This is like driving to the library to look up your own phone number.

3. **The "fallback to filesystem" pattern is a trap.** If you add a DB-first-then-filesystem fallback, you're enshrining the session file as a permanent secondary data source. Six months from now someone will say "but the fallback handles it" and never migrate the remaining callers. Kill the filesystem read or don't, but don't create a "graceful degradation" path that becomes a permanent crutch.

4. **What about `_resolveWorkspaceRootForSession()`?** If `workspaceRoot` isn't passed by the caller, the code calls `_resolveWorkspaceRootForSession(sessionId)` — and I'd bet my 401k that method ALSO reads session files. So you'll fix `_resolvePlanContextForSession`, only for the workspace-root resolver to blow up first. Have you traced that path?

5. **No tests.** There are no unit tests for `_resolvePlanContextForSession`. There are no integration tests for the card-click flow. You're proposing to change the data source for the three most critical user-facing operations with zero automated verification. Bold strategy.

### Balanced Response
Grumpy raises valid structural concerns. Here's how we address each:

1. **DB-first with filesystem fallback is the correct interim strategy.** Yes, ideally we'd delete the filesystem path entirely. But the companion plan ("stop session files being created") hasn't landed yet, and existing installations may have session files but incomplete DB records (e.g., from versions before the DB migration). The fallback ensures zero regression for those users. We will add a `// TECH-DEBT:` comment marking the fallback for removal once the session-file creation plan is complete.

2. **`_handleCopyPlanLink` will be refactored to use `_resolvePlanContextForSession` for the shared logic** (plan file resolution, topic extraction, workspace root). The kanban column will be sourced from the DB record's `kanbanColumn` field instead of re-deriving from events. This eliminates the copy-paste duplication and the dependency on the events array.

3. **`_resolveWorkspaceRootForSession` concern is valid but out of scope.** Tracing that method: it's only called when `workspaceRoot` is not provided. In the kanban card click flow, `workspaceRoot` IS always provided by the webview message (`msg.workspaceRoot`). The command handler in `extension.ts` passes it through. However, as a safety net, if DB lookup is attempted and `workspaceRoot` is available, we use it directly. We don't need to fix `_resolveWorkspaceRootForSession` in this plan.

4. **Testing strategy:** Manual verification is appropriate for this fix given it's a VS Code extension with webview interactions. The verification plan below includes specific repro steps. Automated tests for `_resolvePlanContextForSession` would require mocking the VS Code API, the filesystem, and the database — the cost/benefit ratio doesn't justify it for this surgical change.

5. **The fallback will be clearly marked as temporary.** The `// TECH-DEBT:` annotation ensures the next engineer (or the "stop session files" plan) knows to remove it.

## Proposed Changes
> [!IMPORTANT]
> **MAXIMUM DETAIL REQUIRED:** Provide complete, fully functioning code blocks. Break down the logic step-by-step before showing code.

### TaskViewerProvider — `_resolvePlanContextForSession`
#### MODIFY `src/services/TaskViewerProvider.ts`
- **Context:** This is the shared method called by `_handleReviewPlan`, `_handleViewPlan`, and (after refactoring) `_handleCopyPlanLink`. It currently reads the session JSON file from disk, which fails when the file doesn't exist (cross-machine sync, deleted sessions, etc.). The KanbanDatabase already stores `plan_file`, `topic`, and `brain_source_path` per session via `getPlanBySessionId()`.
- **Logic:**
  1. Resolve `workspaceRoot` (same as current).
  2. **NEW: Try DB lookup first.** Call `this._getKanbanDb(resolvedWorkspaceRoot)` to get the database instance, then `db.getPlanBySessionId(sessionId)` to get the plan record.
  3. If the DB record exists and has a `planFile` (or `brainSourcePath`), use it to resolve the plan path and topic. Skip the filesystem entirely.
  4. If the DB record is missing or has no plan file, **fall back** to the current filesystem-based read (for backward compatibility with installations that have session files but incomplete DB records).
  5. Validate the resolved plan path with `_isPathWithinRoot()` (unchanged).
  6. Return `{ planFileAbsolute, topic, workspaceRoot }` (unchanged interface).
- **Implementation:**
```typescript
private async _resolvePlanContextForSession(sessionId: string, workspaceRoot?: string): Promise<{ planFileAbsolute: string; topic: string; workspaceRoot: string }> {
    const resolvedWorkspaceRoot = workspaceRoot
        ? this._resolveWorkspaceRoot(workspaceRoot)
        : await this._resolveWorkspaceRootForSession(sessionId);
    if (!resolvedWorkspaceRoot) {
        throw new Error('No workspace folder found.');
    }

    // DB-first: resolve plan context from KanbanDatabase (no filesystem dependency)
    let planPath = '';
    let topic = '';
    const db = await this._getKanbanDb(resolvedWorkspaceRoot);
    if (db) {
        const record = await db.getPlanBySessionId(sessionId);
        if (record) {
            planPath = (typeof record.planFile === 'string' && record.planFile.trim())
                ? record.planFile.trim()
                : (typeof record.brainSourcePath === 'string' && record.brainSourcePath.trim() ? record.brainSourcePath.trim() : '');
            topic = (typeof record.topic === 'string' && record.topic.trim())
                ? record.topic.trim()
                : '';
        }
    }

    // TECH-DEBT: Filesystem fallback — remove once session-file creation is fully eliminated
    if (!planPath) {
        try {
            const runSheetPath = path.join(resolvedWorkspaceRoot, '.switchboard', 'sessions', `${sessionId}.json`);
            const content = await fs.promises.readFile(runSheetPath, 'utf8');
            const sheet = JSON.parse(content);
            planPath = (typeof sheet.planFile === 'string' && sheet.planFile.trim())
                ? sheet.planFile.trim()
                : (typeof sheet.brainSourcePath === 'string' && sheet.brainSourcePath.trim() ? sheet.brainSourcePath.trim() : '');
            if (!topic) {
                topic = (typeof sheet.topic === 'string' && sheet.topic.trim())
                    ? sheet.topic.trim()
                    : '';
            }
        } catch {
            // Session file not found or unreadable — DB was the last hope
        }
    }

    if (!planPath) {
        throw new Error('No plan file associated with this session.');
    }

    const planFileAbsolute = path.resolve(resolvedWorkspaceRoot, planPath);
    if (!this._isPathWithinRoot(planFileAbsolute, resolvedWorkspaceRoot)) {
        throw new Error('Plan file path is outside the workspace boundary.');
    }

    if (!topic) {
        topic = path.basename(planFileAbsolute);
    }

    return { planFileAbsolute, topic, workspaceRoot: resolvedWorkspaceRoot };
}
```
- **Edge Cases Handled:**
  - **Session file missing (the bug):** DB lookup succeeds, filesystem read is skipped entirely.
  - **DB record missing (legacy installation):** Filesystem fallback is attempted, preserving backward compatibility.
  - **Both missing:** Clear error message `'No plan file associated with this session.'`.
  - **DB record exists but `planFile` is empty:** Falls through to filesystem fallback, then to `brainSourcePath` in both paths.
  - **Path traversal:** `_isPathWithinRoot()` check is preserved regardless of data source.

### TaskViewerProvider — `_handleCopyPlanLink`
#### MODIFY `src/services/TaskViewerProvider.ts`
- **Context:** This method duplicates the session-file-read logic from `_resolvePlanContextForSession` and additionally derives the kanban column from the `events` array in the session file. It must be refactored to: (a) use `_resolvePlanContextForSession` for plan/topic resolution, and (b) source the kanban column from the DB record's `kanbanColumn` field instead of re-deriving from events.
- **Logic:**
  1. Resolve `workspaceRoot` (same as current).
  2. Call `_resolvePlanContextForSession()` to get `planFileAbsolute`, `topic`, and `resolvedWorkspaceRoot`. This replaces the inline session-file read.
  3. **NEW: Get kanban column from DB.** Call `this._getKanbanDb(resolvedWorkspaceRoot)` then `db.getPlanBySessionId(sessionId)` to get the stored `kanbanColumn`. Use the provided `column` parameter as override if present; otherwise use the DB column; otherwise default to `'CREATED'`.
  4. Rest of the method (complexity lookup, prompt building, clipboard write, runsheet update) remains unchanged.
- **Implementation:**
```typescript
private async _handleCopyPlanLink(sessionId: string, column?: string, workspaceRoot?: string): Promise<boolean> {
    try {
        const { planFileAbsolute, topic, workspaceRoot: resolvedWorkspaceRoot } = await this._resolvePlanContextForSession(sessionId, workspaceRoot);

        // Resolve kanban column: explicit param > DB record > default
        let effectiveColumn = column || '';
        if (!effectiveColumn) {
            const db = await this._getKanbanDb(resolvedWorkspaceRoot);
            if (db) {
                const record = await db.getPlanBySessionId(sessionId);
                if (record && record.kanbanColumn) {
                    effectiveColumn = record.kanbanColumn;
                }
            }
        }
        // TECH-DEBT: Filesystem fallback for kanban column — remove once session-file creation is fully eliminated
        if (!effectiveColumn) {
            try {
                const runSheetPath = path.join(resolvedWorkspaceRoot, '.switchboard', 'sessions', `${sessionId}.json`);
                const content = await fs.promises.readFile(runSheetPath, 'utf8');
                const sheet = JSON.parse(content);
                const customAgentsForColumn = await this.getCustomAgents(resolvedWorkspaceRoot);
                effectiveColumn = deriveKanbanColumn(Array.isArray(sheet.events) ? sheet.events : [], customAgentsForColumn);
            } catch {
                // Session file not available — use default
            }
        }
        effectiveColumn = this._normalizeLegacyKanbanColumn(effectiveColumn || 'CREATED');

        const customAgents = await this.getCustomAgents(resolvedWorkspaceRoot);

        // For PLAN REVIEWED, use complexity-based role selection
        let role: string;
        if (effectiveColumn === 'PLAN REVIEWED' && this._kanbanProvider) {
            const complexity = await this._kanbanProvider.getComplexityFromPlan(resolvedWorkspaceRoot, planFileAbsolute);
            role = complexity === 'Low' ? 'coder' : 'lead';
        } else {
            role = columnToPromptRole(effectiveColumn) || 'coder';
        }

        const plan: BatchPromptPlan = { topic, absolutePath: planFileAbsolute };
        const copyInstruction = role === 'coder' ? 'low-complexity' : undefined;
        const { baseInstruction: resolvedInstruction, includeInlineChallenge } = this._getPromptInstructionOptions(role, copyInstruction);
        // Accuracy mode excluded from clipboard prompts — requires MCP tools only in CLI terminals
        let textToCopy = buildKanbanBatchPrompt(role, [plan], {
            instruction: resolvedInstruction,
            includeInlineChallenge,
            accurateCodingEnabled: false
        });
        const customAgent = findCustomAgentByRole(customAgents, effectiveColumn);
        if (customAgent?.promptInstructions) {
            textToCopy += `\n\nAdditional Instructions: ${customAgent.promptInstructions}`;
        }

        await vscode.env.clipboard.writeText(textToCopy);
        this._view?.webview.postMessage({ type: 'copyPlanLinkResult', success: true });
        const workflowName = effectiveColumn === 'CREATED'
            ? 'improve-plan'
            : effectiveColumn === 'PLAN REVIEWED'
                ? (role === 'lead' ? 'handoff-lead' : 'handoff')
                : this._isCompletedCodingColumn(effectiveColumn)
                    ? 'reviewer-pass'
                    : undefined;
        if (workflowName) {
            try {
                await this._updateSessionRunSheet(sessionId, workflowName);
            } catch (updateError) {
                console.error(`[TaskViewerProvider] Failed to auto-advance runsheet after copy for ${sessionId}:`, updateError);
            }
        }
        return true;
    } catch (e: any) {
        const errorMessage = e?.message || String(e);
        this._view?.webview.postMessage({ type: 'copyPlanLinkResult', success: false, error: errorMessage });
        vscode.window.showErrorMessage(`Failed to copy plan link: ${errorMessage}`);
        return false;
    }
}
```
- **Edge Cases Handled:**
  - **Session file missing:** Plan resolution uses DB via `_resolvePlanContextForSession`. Column resolution uses DB's `kanbanColumn`. No filesystem dependency.
  - **Column parameter explicitly provided by caller:** Used directly, DB/filesystem lookup skipped.
  - **DB has no kanban column, session file also missing:** Falls back to `'CREATED'` default — safe because most new plans start in CREATED.
  - **All existing callers that pass `column` explicitly:** Unchanged behavior.

## Verification Plan
### Automated Tests
- No existing unit tests cover `_resolvePlanContextForSession` or `_handleCopyPlanLink`. Adding mocked unit tests is out of scope for this fix (would require mocking VS Code API, filesystem, and KanbanDatabase). The code changes are surgical and the manual verification below covers the critical paths.

### Manual Tests
1. **Repro the original bug (before fix):**
   - Create plans on one machine (or manually delete `.switchboard/sessions/` directory).
   - Click a kanban card → verify the ENOENT error appears.
2. **Verify the fix — Review Plan:**
   - With session files deleted but DB intact, click "Review" on a kanban card.
   - Verify the review panel opens with correct plan content and topic.
3. **Verify the fix — View Plan:**
   - With session files deleted, click "View Plan" on a kanban card.
   - Verify the plan file opens in the editor.
4. **Verify the fix — Copy Plan Link:**
   - With session files deleted, click "Copy Link" on a kanban card.
   - Paste the clipboard content → verify it contains the correct prompt with plan topic and path.
5. **Verify backward compatibility:**
   - With session files present AND DB records present, click all three actions.
   - Verify identical behavior to pre-fix (DB is used, but results should be the same).
6. **Verify fallback path:**
   - With DB record missing (e.g., clear the DB) but session file present, click a kanban card.
   - Verify the filesystem fallback kicks in and the card opens correctly.
7. **Build verification:**
   - Run `npm run compile` (or equivalent) to confirm no TypeScript errors.
   - Run `npm run lint` if available.

## Recommendation
**Send to Coder.** This is a focused bug fix with clear scope: two methods in one file, using existing APIs (`_getKanbanDb`, `getPlanBySessionId`). The changes are mechanical — replacing one data source with another while preserving the same interface and adding a fallback. No architectural decisions, no new APIs, no schema changes. A competent coder with the implementation spec above can execute this in a single session.

## Reviewer Pass
**Date:** 2026-03-26

### Grumpy Findings

| # | Severity | Finding |
|---|----------|---------|
| 1 | **NIT** | **Redundant DB lookup.** `_resolvePlanContextForSession` calls `db.getPlanBySessionId(sessionId)` (line 5448), then `_handleCopyPlanLink` calls it again (line 6062) for `kanbanColumn`. Two round-trips for the same row. |
| 2 | **NIT** | **Two filesystem fallback sites.** `_resolvePlanContextForSession` has its own fallback (line 5459), and `_handleCopyPlanLink` has a separate inline fallback for kanban column (line 6068). Future cleanup requires touching both. |

No CRITICAL or MAJOR findings. All 6 plan requirements verified as satisfied:
1. ✅ DB-first lookup via `getPlanBySessionId` (line 5448)
2. ✅ `_handleCopyPlanLink` delegates to `_resolvePlanContextForSession` (line 6055)
3. ✅ Kanban column sourced from DB `record.kanbanColumn` (line 6063)
4. ✅ `_isPathWithinRoot()` check preserved (line 5483)
5. ✅ `// TECH-DEBT:` comments on both filesystem fallbacks (lines 5459, 6068)
6. ✅ Clear error: `'No plan file associated with this session.'` (line 5479)

### Balanced Synthesis

| Finding | Disposition | Rationale |
|---------|-------------|-----------|
| NIT-1: Redundant DB lookup | **Dismiss** | SQLite read is sub-millisecond on user click. Expanding `_resolvePlanContextForSession` to return the full DB record would couple the shared method to copy-link's specific needs. |
| NIT-2: Two fallback sites | **Dismiss** | Both are marked `// TECH-DEBT:`. When the companion "stop session files" plan lands, `grep TECH-DEBT` will find both for removal. |

### Files Changed
None. Implementation matches plan specification exactly — no code fixes required.

### Verification Results
- `npm run compile`: ✅ Passed (webpack compiled successfully, exit code 0)

### Remaining Risks
- **`_resolveWorkspaceRootForSession`** still reads session files (as noted in the plan's adversarial review). Out of scope — `workspaceRoot` is always provided in the kanban card click flow — but worth tracking for the session-file elimination effort.
- **No automated test coverage** for these methods. Manual verification per the plan's test matrix is the mitigation.
