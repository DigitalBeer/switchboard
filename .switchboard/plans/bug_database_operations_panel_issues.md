# Database Operations Sidebar Panel - Bug Fix Plan

## Goal
Consolidate UI sections in the database operations sidebar panel by removing the Archive Storage and CLI Tools sections, and replacing them with a single context-aware "Query Archives" Analyst button.

## Metadata
**Tags:** UI, bugfix, database, frontend
**Complexity:** High

## User Review Required
> [!NOTE]
> This change removes the manual path entry for the DuckDB archive and the DuckDB CLI installation button from the sidebar. Users will now rely on the Analyst agent to guide them through archive setup and querying.

## Complexity Audit
### Routine
- Remove the "Archive Storage" and "CLI Tools" HTML sections from `src/webview/implementation.html`.
- Add a new "Query Archives" button in the Analyst panel area of `src/webview/implementation.html` (and optionally `src/webview/kanban.html`).
- Remove obsolete message handlers (`editArchivePath`, `installCliTool`, `openCliTerminal`) from `src/services/TaskViewerProvider.ts`.
- Mark Issue 3 and pending additional issues as closed.

### Complex / Risky
- Implementing the new message handler for sending the context-aware prompt to the Analyst agent in `src/services/TaskViewerProvider.ts`. This requires dynamically determining the current state of DuckDB installation and Archive configuration.
- Ensuring the Analyst agent is capable of handling the setup and query workflow seamlessly without the old UI elements.

## Edge-Case & Dependency Audit
- **Race Conditions:** No significant race conditions anticipated as the Analyst interaction is inherently asynchronous and conversational.
- **Security:** Sending commands to the Analyst is safe; however, we must ensure the context prompt doesn't inadvertently expose sensitive raw paths if the Analyst logs them insecurely.
- **Side Effects:** Removing manual CLI installation buttons might frustrate users who prefer direct control over the Analyst conversational flow.
- **Dependencies & Conflicts:** This plan conflicts with `database_sync_panel_improvements.md` which also modifies the "Database & Sync" panel in `src/webview/implementation.html` and `src/services/TaskViewerProvider.ts`. Specifically, `database_sync_panel_improvements.md` attempts to fix the `installCliTool` handler for DuckDB, which this plan proposes to delete entirely.

## Adversarial Synthesis
### Grumpy Critique
"You're deleting functional UI buttons and replacing them with a chat prompt? What if the Analyst goes off the rails and hallucinates SQL syntax? Furthermore, another plan (`database_sync_panel_improvements.md`) is actively trying to fix the `installCliTool` DuckDB terminal auto-open logic. If you delete that handler here, you're going to cause a massive merge conflict and break the other developer's work! Also, 'context-aware prompt' is just a fancy way of saying string concatenation. What happens if `archiveConfigured` checks block the main thread?"

### Balanced Response
Grumpy is right about the conflict with `database_sync_panel_improvements.md`. Since this plan redesigns the workflow to rely on the Analyst, it supersedes the UI-level fixes for the `installCliTool` button in the other plan. We will proceed with removing the CLI tools section here, but we must ensure the Lead Coder is aware of the overlap. Regarding the Analyst, the prompt provides explicit tool instructions (`query_plan_archive`, `search_archive`) to guide it, reducing hallucination risk. State checks for DuckDB and Archive will use existing asynchronous configuration getters to avoid blocking the main thread.

## Bug Registry

### Issue 1: Archive Storage Path Requires Manual Entry (No Presets)
**Status:** Superseded by Issue 2 
**Priority:** Medium  

The DuckDB archive storage path requires manual entry with no quick-setup preset buttons. It should auto-derive from the kanban database location (local → local, cloud → same cloud provider).

**Current behavior:**
- Users must manually type/paste the full archive path
- No preset buttons like kanban database has (Google Drive, Dropbox, iCloud)

**Expected behavior:**
- Archive path should default to same storage type as kanban.db
- If kanban.db is local → archive.duckdb is local
- If kanban.db is cloud → archive.duckdb is in same cloud folder

**Files affected:**
- `src/webview/implementation.html`
- `src/services/ArchiveManager.ts`
- `src/services/TaskViewerProvider.ts` (handlers)

---

### Issue 2: Archive UI Should Be Consolidated into Analyst Workflow
**Status:** Active  
**Priority:** High  
**Type:** UX Redesign  

**Current approach (problematic):**
- Separate "Archive Storage" section with manual path entry
- Separate "CLI Tools" section with DuckDB install status
- "Open DuckDB Terminal" button exposing raw SQL
- User must configure and query manually

**Proposed approach:**
Remove the Archive Storage and CLI Tools sections entirely. Replace with a single "Query Archives" button in the Analyst panel that:

1. **Sends context-aware prompt to analyst agent:**
   - Outlines available MCP tools (`query_plan_archive`, `search_archive`)
   - Provides the archive DB path if configured
   - Notes if DuckDB is not installed

2. **Analyst handles setup transparently:**
   - If no archive configured: Analyst helps user set it up (can use same logic as kanban.db presets)
   - If DuckDB not installed: Analyst guides installation or can even trigger the install command
   - If everything ready: Analyst helps construct queries conversationally

3. **User never sees:**
   - Raw database paths
   - SQL syntax
   - CLI installation status lights
   - Empty terminal prompts

**Affects Issues:**
- Supersedes Issue 1 (presets not needed if analyst handles setup)

---

### Issue 3: No additional issues reported
**Status:** Closed
Clarification: The original plan expected the user to provide more issues, but none were logged. Marking this section as resolved to unblock implementation.

## Proposed Changes
> [!IMPORTANT]
> **MAXIMUM DETAIL REQUIRED:** Provide complete, fully functioning code blocks. Break down the logic step-by-step before showing code.

### `src/webview/implementation.html`
#### [MODIFY] `src/webview/implementation.html`
- **Context:** We need to remove the "Archive Storage" and "CLI Tools" sections to declutter the UI, and add a "Query Archives" button.
- **Logic:** Delete the specific `<div class="db-subsection">` blocks for Archive Storage and CLI Tools. Add the new "Query Archives" button where appropriate in the Analyst/Airlock section.
- **Implementation:** 
Delete the following HTML from the file entirely:
```html
<!-- Archive Storage -->
<div class="db-subsection">
  <div class="subsection-header"><span>📦</span><span>Archive Storage</span></div>
  <div class="db-path-display" id="archive-path-text">...</div>
  <button id="db-edit-archive-btn">Edit Archive Path</button>
  <!-- Missing: preset buttons -->
</div>

<!-- CLI Tools -->
<div class="db-subsection">
  <div class="subsection-header"><span>🛠️</span><span>CLI Tools</span></div>
  <div class="db-tool-row">
    <span>DuckDB</span>
    <span id="duckdb-status">Not installed</span>
    <button id="duckdb-install-btn">Install</button>
  </div>
  <button id="open-duckdb-btn" disabled>Open DuckDB Terminal</button>
</div>
```

Inject the new button in the analyst section (e.g., inside the Analyst/Airlock tab container):
```html
<button id="btn-query-archives" class="secondary-btn w-full mt-2" data-tooltip="Ask Analyst to query archived plans">
  📦 Query Archives
</button>
```
- **Edge Cases Handled:** Reduces UI complexity and removes the chance for users to enter broken manual archive paths.

### `src/services/TaskViewerProvider.ts`
#### [MODIFY] `src/services/TaskViewerProvider.ts`
- **Context:** Remove obsolete manual UI handlers (`editArchivePath`, `installCliTool`, `openCliTerminal`) to complete the transition to the Analyst workflow and implement the new `queryArchives` handler.
- **Logic:** 
  1. Remove `case 'editArchivePath':`, `case 'installCliTool':`, and `case 'openCliTerminal':` entirely.
  2. Add `case 'queryArchives':` which reads config states and kicks off an Analyst session.
- **Implementation:**
Remove handlers for `editArchivePath`, `installCliTool`, and `openCliTerminal`. Then add:
```typescript
                    case 'queryArchives': {
                        // Gather context
                        const config = vscode.workspace.getConfiguration('switchboard');
                        const archivePath = config.get<string>('archive.dbPath');
                        const archiveConfigured = !!archivePath;
                        
                        // Check if duckdb is installed
                        const duckdbInstalled = await this._checkIfDuckDBInstalled(); 

                        const instruction = `Help me query the DuckDB archive. Available tools:
- query_plan_archive: Run SELECT queries on archived plans
- search_archive: Keyword search across conversations

Current status: ${archiveConfigured ? 'Archive at ' + archivePath : 'Archive not configured'}
${duckdbInstalled ? 'DuckDB ready' : 'DuckDB needs installation'}

What would you like to find?`;

                        // Send to Analyst
                        vscode.commands.executeCommand('switchboard.startWorkflow', {
                            name: 'chat',
                            targetAgent: 'analyst',
                            initialContext: instruction
                        });
                        break;
                    }
```
*(Note: Ensure `_checkIfDuckDBInstalled()` exists or is appropriately abstracted in the actual implementation.)*
- **Edge Cases Handled:** Safely bundles configuration context before dynamically invoking the Analyst, ensuring a smooth handoff.

## Verification Plan
### Automated Tests
- Run `npm run compile` to ensure removing handlers doesn't cause TS compiler issues.
- Validate that the Analyst routing correctly picks up the initial context when `queryArchives` is triggered.

## Reviewer Pass — 2026-03-30

### Stage 1: Grumpy Principal Engineer

*Adjusts bifocals. Opens file. Sighs.*

**[MAJOR] M-1: "Query Archives" button has no guard rails (implementation.html:3805-3816)**

Oh, *wonderful*. So the "SEND QUESTION" button at line 3775 dutifully checks `!isReady || pendingDispatch` before letting anyone near the analyst agent — because apparently *someone* on this team understood that you shouldn't let users fire missiles at a target that doesn't exist. But the shiny new "Query Archives" button? No `isReady` check. No `pendingDispatch` check. Just a naked `.onclick` that fires into the void. If there's no analyst terminal connected, the user clicks, `_handleSendAnalystMessage` throws up an error dialog, and the user thinks the feature is broken. Worse, because there's no dispatch-pending guard, a frustrated user rapid-clicking will spawn N concurrent `duckdb --version` subprocesses. In a world where VS Code extensions share a single Node process, this is how you earn yourself a "why is my editor frozen" bug report.

**[NIT] N-1: Plan says `switchboard.startWorkflow`, implementation uses `_handleSendAnalystMessage` (TaskViewerProvider.ts:3599)**

The plan at line 168-173 explicitly specified `vscode.commands.executeCommand('switchboard.startWorkflow', ...)`. The implementation uses `this._handleSendAnalystMessage(instruction)` instead. I'll grudgingly admit this is *better* — it reuses the existing analyst dispatch pipeline with proper security validation (line 8059: `_isValidAgentName`), role resolution (line 8046: `_getAgentNameForRole`), and error handling. But if you're going to deviate from the plan, *document it*. Plans exist so reviewers don't have to reverse-engineer intent from diff hunks. Also: `switchboard.startWorkflow` doesn't even appear anywhere in the codebase as a registered command, so the plan was specifying a phantom API. Someone should have caught that during planning.

**[NIT] N-2: `promisify(cp.execFile)` re-created per click (TaskViewerProvider.ts:3583)**

Every single button press allocates a fresh promisified wrapper around `cp.execFile`. The `promisify` import is at line 8. The `cp` import is at line 7. You could hoist `const execFileAsync = promisify(cp.execFile);` to a module-level constant or a class field. It's not a memory leak per se, but it's the kind of micro-sloppiness that compounds. If a junior sees this pattern, they'll think it's acceptable to re-create utility wrappers inside hot paths.

**[NIT] N-3: Inline styles instead of CSS class (implementation.html:3808-3810)**

`archiveBtn.style.marginTop = '4px'; archiveBtn.style.width = '100%'; archiveBtn.style.opacity = '0.85';` — three inline style assignments when a CSS class would do. The rest of the codebase uses `action-btn` and friends. The opacity trick to make it visually secondary is a design decision that should live in a stylesheet, not buried in JavaScript. Future-you will grep for "where does the opacity come from" and waste 20 minutes.

**[NIT] N-4: Pre-existing `tsc --noEmit` error in KanbanProvider.ts:1472**

Not introduced by this PR, but `import('./ArchiveManager')` is missing the `.js` extension required by `--moduleResolution node16`. Webpack doesn't care, `tsc` does. Someone should fix this eventually, though it's out of scope here.

**What actually went RIGHT (yes, I can be fair):**

- The "Archive Storage" and "CLI Tools" HTML sections are cleanly removed with zero orphaned references. No dead `getElementById` calls, no phantom event listeners. That's rare.
- The `queryArchives` handler (TaskViewerProvider.ts:3576-3601) is clean. Config reading, try/catch around subprocess, template literal for the instruction — all correct.
- Using `_handleSendAnalystMessage` instead of the phantom `startWorkflow` command was the right call. It gets proper dispatch tracking, security validation, and error toasting for free.
- `cp` and `promisify` were already imported (lines 7-8). No new dependencies introduced.
- `npm run compile` passes cleanly. No webpack errors.

### Stage 2: Balanced Synthesis

**Keep As-Is:**
- HTML cleanup: Archive Storage and CLI Tools sections removed completely with no orphaned code. ✅
- `queryArchives` handler in TaskViewerProvider.ts: clean implementation with proper DuckDB detection, config reading, and analyst dispatch. ✅
- Use of `_handleSendAnalystMessage` over the plan's `switchboard.startWorkflow`: correct deviation — the planned API doesn't exist. ✅
- Imports: `cp` and `promisify` already present, no new dependencies. ✅

**Must Fix Now (CRITICAL/MAJOR):**
- **M-1**: Add `isReady` and `pendingDispatch` guards to the "Query Archives" button. Disable it when the analyst terminal is not connected. Add `markDispatchPending('analyst')` in the onclick handler to prevent double-clicks. This matches the pattern used by the sibling "SEND QUESTION" button at line 3775-3798.

**Defer (NITs):**
- N-1: Plan/implementation deviation is acceptable; no action needed beyond this documentation.
- N-2: `promisify` hoisting is a minor efficiency improvement; defer to a future cleanup pass.
- N-3: Inline styles → CSS class migration; defer to a UI polish pass.
- N-4: KanbanProvider.ts import extension error is pre-existing and out of scope.

### Fixes Applied
- **`src/webview/implementation.html` (lines 3805-3820)**: Added `isReady` and `pendingDispatch` guards to the "Query Archives" button. Button now: (1) starts disabled when analyst is not ready or a dispatch is pending, (2) shows "DISPATCHING..." text when either button triggers a dispatch, (3) calls `markDispatchPending('analyst')` and self-disables on click, matching the "SEND QUESTION" button pattern.

### Verification Results
- `npm run compile`: ✅ webpack compiled successfully (2460ms, zero errors)
- `npx tsc --noEmit`: ⚠️ 1 pre-existing error in `KanbanProvider.ts:1472` (missing `.js` extension in dynamic import) — NOT related to this plan's changes

### Remaining Risks
- **N-2 (deferred)**: `promisify(cp.execFile)` re-created per click in `queryArchives` handler. Low impact, but should be hoisted in a future cleanup.
- **N-3 (deferred)**: Inline styles on archive button. Cosmetic; defer to UI polish pass.
- **N-4 (pre-existing)**: `tsc --noEmit` error in `KanbanProvider.ts:1472` — unrelated, but blocks strict CI if `tsc` is ever added to the build pipeline.
