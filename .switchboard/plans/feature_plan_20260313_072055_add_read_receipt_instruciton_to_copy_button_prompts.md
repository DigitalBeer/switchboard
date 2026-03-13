Here is the revised implementation plan. It integrates the proven "signal file" pattern from your Auto tab automations, but adapts it into the global `InboxWatcher` so it works passively for external IDEs without needing active, session-specific polling loops.

***

# Add read receipt instruction to cross-IDE copy prompts

## Goal
Improve Kanban state synchronization for cross-IDE workflows. When a user clicks "Copy Prompt" on a Kanban card, the copied text will instruct the external AI agent to save a "read receipt" (`receipt_<sessionId>.txt`) directly into its designated role folder within `.switchboard/inbox/<role>/`. The `InboxWatcher` will passively detect this file, instantly update the session's runsheet, and seamlessly move the Kanban card to the next column.

## User Review Required
> [!NOTE]
> This introduces a new cross-IDE state synchronization mechanism. Users pasting prompts into external agents (like Windsurf) will now see their Kanban board automatically advance when the agent acknowledges the task. 

## Complexity Audit
### Band A — Routine
- Appending the read receipt instruction string to the `promptToCopy` payload in `TaskViewerProvider.ts`.
- Registering a new `switchboard.kanbanAcknowledgeReceipt` command in `src/extension.ts`.

### Band B — Complex / Risky
- Updating the file glob patterns and native `fs.watch` filters in `InboxWatcher.ts` to accept `.txt` files in addition to `.json` files.
- Bridging the receipt detection safely to the runsheet state engine so the Kanban board advances correctly based on architectural workflow events, avoiding JSON-parsing crashes.

## Edge-Case Audit
- **Race Conditions:** If an agent creates the receipt file but the extension is restarting, the polling mechanism of `InboxWatcher` must catch it. The `fs.existsSync` sweeps during `scanAllInboxes` handle this. If the user manually drags the card right as the agent writes the receipt, `TaskViewerProvider`'s existing deduplication logic (`if (lastEvent && lastEvent.workflow === workflow)`) will safely ignore the redundant update.
- **Security:** No new attack vectors. Filenames are strictly parsed with a regex (`/^receipt_(.+)\.txt$/`) before any state updates occur.
- **Side Effects:** By using a `.txt` extension instead of `.json`, we bypass the strict JSON-parsing and HMAC signature validation intended for cross-agent `execute` payloads, providing a safe, lightweight "ping" mechanism exactly like the Auto tab's `.md` signal files.

## Adversarial Synthesis
### Grumpy Critique
You're relying on external LLMs to correctly write a file to a specific relative path? LLMs are notoriously bad at getting paths right! What if they write it to `.switchboard/inbox/receipt.txt` instead of the role folder? Or what if they include a bunch of extra text inside the file and it's not actually empty? The watcher is going to miss it or crash!

### Balanced Response
Grumpy's skepticism of LLM reliability is well-founded. By explicitly including the target path in the copy prompt, we maximize the chance of success, but we must be resilient to failures. If the agent writes the file to the wrong folder, the state simply won't advance—a safe failure mode that the user can manually override by dragging the card. As for the file contents, our `InboxWatcher` logic completely ignores the file's payload; it only cares that the file exists and matches the `receipt_<sessionId>.txt` regex, so extra text inside the file will not cause a crash.

## Proposed Changes

### 1. Update Copy Prompts with Target Role
#### [MODIFY] `src/services/TaskViewerProvider.ts`
- **Context:** The prompt copied to the user's clipboard needs to tell the agent exactly what filename to create and where.
- **Logic:** In `_handleCopyPlanLink`, map the current column to the *target role* (e.g., `CREATED` -> `planner`). Append the instruction to create `.switchboard/inbox/${targetRole}/receipt_${sessionId}.txt`.
- **Implementation:** Add a `targetRole` variable to the conditional blocks. If a `targetRole` is resolved, append: `\n\nIMPORTANT: Before starting, save an empty file named \`receipt_${sessionId}.txt\` to the \`.switchboard/inbox/${targetRole}/\` directory to acknowledge receipt.`

### 2. Extend InboxWatcher to Detect Receipts
#### [MODIFY] `src/services/InboxWatcher.ts`
- **Context:** The watcher currently ignores all non-JSON files.
- **Logic:** 
  1. Change the glob in `setupRootWatcher` to `**/*.{json,txt}`.
  2. Change the `fs.watch` fallback check to explicitly allow `.txt`.
  3. In `processUri`, intercept filenames matching `/^receipt_(.+)\.txt$/`. Extract the role from the parent directory (`path.basename(path.dirname(filePath))`).
- **Implementation:** Route these to a new `handleReceiptFile(uri, role, sessionId)` method that calls `vscode.commands.executeCommand('switchboard.kanbanAcknowledgeReceipt', sessionId, role)` and safely deletes the text file.

### 3. Create the Acknowledgment Command
#### [MODIFY] `src/extension.ts`
- **Context:** `InboxWatcher` needs a bridge to `TaskViewerProvider` to apply the state change.
- **Logic:** Register `switchboard.kanbanAcknowledgeReceipt` and pass the arguments to `taskViewerProvider.handleKanbanReceipt(sessionId, role)`.

### 4. Apply Runsheet State Updates
#### [MODIFY] `src/services/TaskViewerProvider.ts`
- **Context:** The provider must translate the acknowledged role into the correct runsheet event to move the card.
- **Logic:** Add `public async handleKanbanReceipt(sessionId: string, role: string)`. Map the role to the correct workflow name (`planner` -> `sidebar-review`, `coder` -> `handoff`, `reviewer` -> `reviewer-pass`). Call `await this._updateSessionRunSheet(sessionId, workflowName);`.

## Verification Plan
### Automated Tests
- Run `npm run compile` to verify glob syntax updates and TypeScript interfaces.

### Manual Testing
1. Create a plan so it sits in the **Plan Created** column.
2. Click **Copy planning prompt**.
3. Paste the prompt into an external editor or terminal. Verify the text includes the instruction to create `receipt_[sessionId].txt` in the `planner` folder.
4. Manually run `touch .switchboard/inbox/planner/receipt_[sessionId].txt` from your terminal.
5. Verify the file is immediately consumed and deleted.
6. Verify the Kanban card instantly moves to the **Plan Reviewed** column.

---

## Appendix: Implementation Patch

```diff
--- src/services/TaskViewerProvider.ts
+++ src/services/TaskViewerProvider.ts
@@ -1523,14 +1523,19 @@
             const planUri = vscode.Uri.file(planPathAbsolute).toString();
             const markdownLink = `[${topic}](${planUri})`;
 
             let textToCopy = markdownLink;
+            let targetRole = '';
             if (column === 'CREATED') {
+                targetRole = 'planner';
                 textToCopy = `Please review and enhance the following plan. Execute the .agent/workflows/enhance.md workflow to break it down into distinct steps grouped by high complexity and low complexity:\n\n${markdownLink}`;
             } else if (column === 'PLAN REVIEWED') {
+                targetRole = 'coder';
                 textToCopy = `Please execute the following plan. Use the linked file as the single source of truth:\n\n${markdownLink}`;
             } else if (column === 'CODED') {
+                targetRole = 'reviewer';
                 textToCopy = `The implementation for the following plan is complete. Please review the code against the plan requirements and identify any defects:\n\n${markdownLink}`;
             }
+            if (targetRole) {
+                textToCopy += `\n\nIMPORTANT: Before starting, save an empty file named \`receipt_${sessionId}.txt\` to the \`.switchboard/inbox/${targetRole}/\` directory to acknowledge receipt.`;
+            }
 
             await vscode.env.clipboard.writeText(textToCopy);
             this._view?.webview.postMessage({ type: 'copyPlanLinkResult', success: true });
@@ -1571,6 +1576,14 @@
         }
     }
 
+    public async handleKanbanReceipt(sessionId: string, role: string) {
+        let workflowName = role;
+        if (role === 'planner') workflowName = 'sidebar-review';
+        else if (role === 'coder') workflowName = 'handoff';
+        else if (role === 'reviewer') workflowName = 'reviewer-pass';
+        await this._updateSessionRunSheet(sessionId, workflowName);
+    }
+
     private async _updateSessionRunSheet(sessionId: string, workflow: string, outcome?: string, isStop: boolean = false) {
         const workspaceFolders = vscode.workspace.workspaceFolders;
--- src/services/InboxWatcher.ts
+++ src/services/InboxWatcher.ts
@@ -992,7 +992,7 @@
     private setupRootWatcher(): void {
         const inboxRoot = path.join(this.workspaceRoot, '.switchboard', 'inbox');
 
-        const pattern = new vscode.RelativePattern(inboxRoot, '**/*.json');
+        const pattern = new vscode.RelativePattern(inboxRoot, '**/*.{json,txt}');
         this.rootWatcher = vscode.workspace.createFileSystemWatcher(pattern);
 
         this.rootWatcher.onDidCreate((uri) => this.processUri(uri));
@@ -1004,7 +1004,7 @@
         const inboxRoot = path.join(this.workspaceRoot, '.switchboard', 'inbox');
         try {
             this.fsWatcher = fs.watch(inboxRoot, { recursive: true }, (eventType, filename) => {
-                if (!filename || !filename.endsWith('.json')) return;
+                if (!filename || (!filename.endsWith('.json') && !filename.endsWith('.txt'))) return;
                 const fullPath = path.join(inboxRoot, filename);
                 if (fs.existsSync(fullPath)) {
                     this.processUri(vscode.Uri.file(fullPath));
@@ -1025,6 +1025,14 @@
         const filePath = uri.fsPath;
         const fileName = path.basename(filePath);
 
+        const receiptMatch = fileName.match(/^receipt_(.+)\.txt$/);
+        if (receiptMatch) {
+            const sessionId = receiptMatch;
+            const targetName = path.basename(path.dirname(filePath));
+            await this.handleReceiptFile(uri, targetName, sessionId);
+            return;
+        }
+
         // Must match scanAllInboxes filter: msg_* prefix, .json extension, not result/receipt
         if (!fileName.startsWith('msg_')) return;
         if (!fileName.endsWith('.json')) return;
@@ -1045,7 +1053,8 @@
                 const files = await fs.promises.readdir(dirPath);
                 const msgFiles = files.filter(f => 
                     f.startsWith('msg_') && 
                     f.endsWith('.json') && 
-                    !f.endsWith('.result.json') && 
-                    !f.endsWith('.receipt.json')
+                    !f.endsWith('.result.json') && 
+                    !f.endsWith('.receipt.json') ||
+                    (f.startsWith('receipt_') && f.endsWith('.txt'))
                 );
                 
                 for (const file of msgFiles) {
@@ -1058,6 +1067,23 @@
         }
     }
 
+    private async handleReceiptFile(uri: vscode.Uri, role: string, sessionId: string): Promise<void> {
+        const filePath = uri.fsPath;
+        const fileName = path.basename(filePath);
+        if (this.processingFiles.has(filePath)) return;
+        if (!fs.existsSync(filePath)) return;
+
+        try {
+            this.processingFiles.add(filePath);
+            this.outputChannel.appendLine(`[InboxWatcher] Processing read receipt for session ${sessionId} (role: ${role})`);
+            await vscode.commands.executeCommand('switchboard.kanbanAcknowledgeReceipt', sessionId, this.normalizeAgentKey(role));
+            await this.safeUnlink(filePath);
+        } catch (e) {
+            this.outputChannel.appendLine(`[InboxWatcher] Error handling receipt ${fileName}: ${e}`);
+        } finally {
+            this.processingFiles.delete(filePath);
+        }
+    }
 
     private async handleMessageFile(uri: vscode.Uri, targetName: string): Promise<void> {
--- src/extension.ts
+++ src/extension.ts
@@ -266,6 +266,11 @@
     });
     context.subscriptions.push(viewPlanFromKanbanDisposable);
 
+    const acknowledgeReceiptDisposable = vscode.commands.registerCommand('switchboard.kanbanAcknowledgeReceipt', async (sessionId: string, role: string) => {
+        taskViewerProvider.handleKanbanReceipt(sessionId, role);
+    });
+    context.subscriptions.push(acknowledgeReceiptDisposable);
+
     let degradedMcpStreak = 0;
     let autoHealInFlight = false;
     let lastAutoHealAt = 0;
```