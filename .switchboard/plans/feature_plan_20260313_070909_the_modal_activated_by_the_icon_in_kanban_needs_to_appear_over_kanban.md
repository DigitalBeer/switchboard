# The modal activated by the + icon in kanban needs to appear over kanban

## Goal
Improve context retention by rendering the "Create Plan" modal as a direct overlay within the Kanban board, rather than shifting the user's focus to the sidebar webview.

## User Review Required
> [!NOTE]
> VS Code Webviews are strictly isolated, meaning we cannot share DOM elements between the Sidebar (`implementation.html`) and the Kanban Board (`kanban.html`). This plan deliberately duplicates the modal's HTML/CSS to achieve the overlay UX.

## Complexity Audit
### Band A — Routine
- Duplicating the modal's HTML structure, CSS styling, and basic open/close JS logic into `src/webview/kanban.html`.
- Removing the old `createPlan` IPC trigger attached to the Kanban `+` button.

### Band B — Complex / Risky
- Safely bridging the isolated Kanban webview to the core plan-creation engine by exposing `TaskViewerProvider._handleInitiatePlan` via a new global VS Code command, ensuring plan creation logic remains strictly centralized.

## Edge-Case Audit
- **Race Conditions:** None. Plan creation is a synchronous user-driven sequence.
- **Security:** None. The backend still relies on the exact same sanitization and path validation logic in `TaskViewerProvider`. 
- **Side Effects:** The Z-index of the duplicated modal must be set high enough (`z-index: 100`) to guarantee it sits above the auto-move bars and Kanban column headers.

## Adversarial Synthesis
### Grumpy Critique
Exposing `_handleInitiatePlan` globally via a VS Code command just for the Kanban board seems like a massive scope creep! Now any extension could technically trigger plan creation. Did you consider the security implications? Also, duplicating the modal code into `kanban.html` means if we ever change the plan creation fields, we have to remember to update two separate HTML files. This is going to lead to drift and bugs down the line!

### Balanced Response
Grumpy's concern about code duplication is valid and a known trade-off due to VS Code's webview isolation. We will document this duplication clearly in both HTML files to mitigate drift. As for the global command, `switchboard.submitNewPlan` will only be registered internally within our extension's context. While it becomes a public command within the VS Code ecosystem, it still routes through our existing validation logic in `TaskViewerProvider`, so there are no new security risks introduced.

## Proposed Changes
### Kanban Webview
#### [MODIFY] `src/webview/kanban.html`
- **Context:** The Kanban board needs its own local copy of the Create Plan modal to show it as an overlay.
- **Logic:** Add the `.modal-overlay`, `.modal-card`, and related CSS classes. Inject the modal HTML at the bottom of the body. Modify the `btn-add-plan` click listener to reveal this local modal instead of posting the `createPlan` IPC message. 
- **Implementation:** Add the submit logic to collect `title` and `idea`, and `vscode.postMessage({ type: 'initiatePlan', title, idea, mode: action })` to the backend.

### Kanban Service
#### [MODIFY] `src/services/KanbanProvider.ts`
- **Context:** The provider needs to intercept the new `initiatePlan` IPC message from the webview and forward it to the main extension host.
- **Logic:** Replace the `case 'createPlan'` listener with `case 'initiatePlan'`.
- **Implementation:** Call `vscode.commands.executeCommand('switchboard.submitNewPlan', msg.title, msg.idea, msg.mode)`.

### Task Viewer Provider
#### [MODIFY] `src/services/TaskViewerProvider.ts`
- **Context:** The `_handleInitiatePlan` method currently handles all plan creation but is private.
- **Logic:** Expose a public method that wraps it so the extension command can invoke it.
- **Implementation:** Add `public async handleInitiatePlan(title: string, idea: string, mode: 'send' | 'copy' | 'local' | 'review') { await this._handleInitiatePlan(title, idea, mode); }`.

### Extension Host
#### [MODIFY] `src/extension.ts`
- **Context:** We need a global command to bridge the Kanban Provider to the Task Viewer Provider's creation engine.
- **Logic:** Register `switchboard.submitNewPlan`.
- **Implementation:** Add `vscode.commands.registerCommand('switchboard.submitNewPlan', async (title, idea, mode) => { taskViewerProvider.handleInitiatePlan(title, idea, mode); });`.

## Verification Plan
### Automated Tests
- Run `npm run compile` to verify all TypeScript interfaces compile cleanly across the newly exposed command.

### Manual Verification
1. Open the Kanban board.
2. Click the `+` icon in the "Plan Created" column header.
3. Verify that the "Create Plan" modal appears instantly as a dark overlay directly over the Kanban columns.
4. Enter a title ("Test Kanban Plan") and an idea. Click **SAVE PLAN**.
5. Verify the modal closes and the new plan immediately appears as a card in the "Plan Created" column.
6. Verify the plan also appears in the sidebar's plan dropdown.

## Appendix: Implementation Patch
```diff
--- src/webview/kanban.html
+++ src/webview/kanban.html
@@ -... +... @@
 }
 
+.modal-overlay {
+    position: fixed; inset: 0; background: rgba(0, 0, 0, 0.45);
+    display: flex; align-items: center; justify-content: center; z-index: 100; padding: 10px;
+}
+.modal-card {
+    width: 100%; max-width: 420px; background: var(--panel-bg);
+    border: 1px solid var(--border-bright); border-radius: 4px; padding: 12px;
+}
+.modal-title { font-family: var(--font-mono); letter-spacing: 1px; font-size: 12px; color: var(--accent-teal); margin-bottom: 10px; }
+.modal-label { display: block; margin-bottom: 4px; font-size: 10px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 1px; font-family: var(--font-mono); }
+.modal-input, .modal-textarea {
+    width: 100%; background: #0a0a0a; color: var(--text-primary); border: 1px solid var(--border-color);
+    padding: 7px; font-family: var(--font-mono); font-size: 11px; margin-bottom: 10px;
+}
+.modal-input:hover, .modal-input:focus, .modal-textarea:hover, .modal-textarea:focus { border-color: var(--border-bright); outline: none; }
+.modal-textarea { min-height: 90px; resize: vertical; }
+.hidden { display: none !important; }
+
 </style>
 </head>
@@ -... +... @@
 </div>
 </div>
 
+<div id="initiate-plan-modal" class="modal-overlay hidden">
+    <div class="modal-card">
+        <div class="modal-title">Create Plan</div>
+        <label class="modal-label" for="init-plan-title">Plan title</label>
+        <input id="init-plan-title" class="modal-input" type="text" placeholder="e.g. Improve onboarding conversion">
+        <label class="modal-label" for="init-plan-idea">Feature idea or bug</label>
+        <textarea id="init-plan-idea" class="modal-textarea" placeholder="Describe what should be fixed or built..."></textarea>
+        <div style="display:flex; gap:8px;">
+            <button id="btn-send-planner" class="auto-move-btn" style="flex:1; padding:6px; font-size:10px;">SEND TO PLANNER</button>
+            <button id="btn-save-plan" class="auto-move-btn" style="flex:1; padding:6px; font-size:10px;">SAVE PLAN</button>
+            <button id="btn-cancel-plan" class="auto-move-btn" style="flex:1; padding:6px; font-size:10px; border-color:var(--border-color); color:var(--text-secondary);">CANCEL</button>
+        </div>
+    </div>
+</div>
+
 <script>
 const vscode = acquireVsCodeApi();
@@ -... +... @@
 });
 
 document.getElementById('btn-add-plan').addEventListener('click', () => {
-    vscode.postMessage({ type: 'createPlan' });
+    document.getElementById('initiate-plan-modal').classList.remove('hidden');
+    setTimeout(() => document.getElementById('init-plan-title').focus(), 0);
 });
 
+function closeInitiatePlanModal() {
+    document.getElementById('initiate-plan-modal').classList.add('hidden');
+}
+
+function submitInitiatePlan(action) {
+    const title = document.getElementById('init-plan-title').value.trim();
+    const idea = document.getElementById('init-plan-idea').value.trim();
+    if (!title || !idea) return;
+    vscode.postMessage({ type: 'initiatePlan', title, idea, mode: action });
+    closeInitiatePlanModal();
+    document.getElementById('init-plan-title').value = '';
+    document.getElementById('init-plan-idea').value = '';
+}
+
+document.getElementById('btn-send-planner').addEventListener('click', () => submitInitiatePlan('send'));
+document.getElementById('btn-save-plan').addEventListener('click', () => submitInitiatePlan('local'));
+document.getElementById('btn-cancel-plan').addEventListener('click', closeInitiatePlanModal);
+
 const codedTargetSelect = document.getElementById('coded-target-select');
--- src/services/KanbanProvider.ts
+++ src/services/KanbanProvider.ts
@@ -... +... @@
-            case 'createPlan':
-                await vscode.commands.executeCommand('switchboard.initiatePlan');
-                break;
+            case 'initiatePlan':
+                if (msg.title && msg.idea && msg.mode) {
+                    await vscode.commands.executeCommand('switchboard.submitNewPlan', msg.title, msg.idea, msg.mode);
+                }
+                break;
--- src/services/TaskViewerProvider.ts
+++ src/services/TaskViewerProvider.ts
@@ -... +... @@
+    public async handleInitiatePlan(title: string, idea: string, mode: 'send' | 'copy' | 'local' | 'review') {
+        await this._handleInitiatePlan(title, idea, mode);
+    }
+
     private async _handleInitiatePlan(title: string, idea: string, mode: 'send' | 'copy' | 'local' | 'review') {
--- src/extension.ts
+++ src/extension.ts
@@ -... +... @@
+    const submitNewPlanDisposable = vscode.commands.registerCommand('switchboard.submitNewPlan', async (title: string, idea: string, mode: string) => {
+        await taskViewerProvider.handleInitiatePlan(title, idea, mode as any);
+    });
+    context.subscriptions.push(submitNewPlanDisposable);
+
     const openKanbanDisposable = vscode.commands.registerCommand('switchboard.openKanban', async () => {
```