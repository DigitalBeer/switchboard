# Balanced Review: Replicate 'Review' Feature in Switchboard

**Plan**: `implementation_plan.md` (Conversation 77dd1017)  
**Reviewer**: Lead Developer (Balanced Synthesis)

---

## Summary of Review

The plan identifies a genuinely useful feature — contextual inline commenting on plans. However, it is currently a *feature sketch*, not an implementation plan. The core interaction loop is sound, but every technical layer (text selection, webview lifecycle, CSP compliance, comment routing, and user entry point) is either absent or hand-waved. The plan needs significant hardening before it can be safely delegated.

---

## Valid Concerns

| # | Concern | Priority |
|---|---|---|
| C1 | Plan lacks concrete interaction design for text selection and comment routing | Blocker |
| C2 | Replacing ALL `openPlan` flows with a Review webview is a breaking change | Blocker |
| C3 | CSP compliance for markdown rendering not designed | Blocker |
| M1 | WebviewPanel lifecycle (retain, dispose, reopen) not addressed | High |
| M2 | "Active terminal" routing not designed | High |
| M5 | Kanban entry point (new button vs. existing "View" button) not specified | High |

---

## Action Plan

1. **Gate the Review Webview behind a separate entry point**: Add a `Review` button (or icon) to the Kanban card distinct from `View`. Do NOT replace `switchboard.openPlan`; instead, register a new `switchboard.reviewPlan` command. The existing `View` button remains unchanged.

2. **Design the text selection mechanism explicitly**: The Review webview must inject JS into the webview body that listens for `mouseup` events, calls `window.getSelection()`, and posts a message back to the extension host with `{ selectedText, selectionRect }`. The floating popup must be rendered in the webview itself, not in the extension host.

3. **Use VS Code's built-in markdown rendering, not `marked`**: Call `vscode.commands.executeCommand('markdown.api.render', markdownString)` (available via the `vscode.markdown-language-features` API) or simply serve the raw file content and apply minimal syntax highlighting. Avoid external markdown parsers to stay CSP-compliant.

4. **Design the comment routing explicitly**: When the user submits a comment, the extension should:
   - Look up the active/preferred agent from `state.json` (fallback to `planner` role).
   - Format the message: `> [Selection from plan: "..."] — User comment: "..."`.
   - Dispatch via `sendRobustText` to the resolved terminal.
   - Show a brief in-webview toast on success.

5. **Implement WebviewPanel lifecycle boilerplate**: Follow the same pattern as `KanbanProvider.ts:69-99` — handle `onDidDispose`, use `retainContextWhenHidden: true`, and expose a `reveal()` method.

6. **Specify the `package.json` contribution**: Add `switchboard.reviewPlan` to the commands section of `package.json`. No new dependencies needed if VS Code's markdown API is used.

---

## Dismissed Points

- **N1 (Review file naming)**: Not material to feature correctness. Can be addressed at any time.
- **N2 (Plan title)**: Cosmetic. Not blocking.
- **M3 (`marked` dependency)**: Resolved by Action Plan item 3 — no new dependency needed.
- **M4 (Test strategy)**: The plan acknowledged automated tests as a goal; it's reasonable to defer test implementation until the webview architecture is stable. Manual verification steps are sufficient for the first iteration.
