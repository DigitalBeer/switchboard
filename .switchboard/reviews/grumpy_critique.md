# Grumpy Critique: Replicate 'Review' Feature in Switchboard

**Plan**: `implementation_plan.md` (Conversation 77dd1017)  
**Reviewer**: Principal Engineer (Grumpy Persona)

---

## CRITICAL

### C1 — Plan is vague to the point of uselessness
The plan says "Create a new `ReviewProvider` class to manage the Review Webview" and "Implement logic to render Markdown with selectable blocks." These are *wish statements*, not implementation steps. There is zero detail on:
- How text selection is captured (VS Code webview has no access to native selection APIs by default — you must use `document.getSelection()` in the webview JS, not in the extension host).
- How the floating popup is positioned without clipping at viewport edges.
- How the comment is *routed* to the active terminal. Which terminal? The last one? The one assigned to the role `coder`? If no terminal is active, what happens?

**File ref**: `src/extension.ts:1194` — the `switchboard.openPlan` command that this plan proposes to modify is a *3-line function*. But the new behaviour it must replace is a full lifecycle-managed custom editor. The plan has no awareness of what it's actually replacing.

### C2 — Replaces ALL plan opens, not just review-mode ones
The plan states: "Update `switchboard.openPlan` to use the `ReviewProvider` instead of the default `markdown.showPreview`."

This is a breaking change. `switchboard.openPlan` is called from **every** "View" button on the Kanban board. Users who want to simply read a plan will now be forced into a heavyweight custom webview instead of the native markdown preview. There is no fallback, no preview vs. review mode distinction, no user toggle mentioned. The `switchboard.plans.defaultOpenMode` setting at `package.json:158` already controls a `preview`/`edit` toggle — this plan ignores that entirely and overrides without discussion.

### C3 — Using `marked` (a browser-side markdown parser) inside a VS Code webview introduces a CSP incident
The plan says "Use a markdown parser (like `marked`) to render the plan content." VS Code webviews enforce a strict Content Security Policy (see `KanbanProvider.ts:543`). Loading a CDN copy of `marked` will be **blocked outright**. Bundling it adds a non-trivial build step not mentioned in the plan. Failing to sanitise the output of `marked` opens up XSS vectors — plan files could contain arbitrary HTML via raw markdown.

**File ref**: `KanbanProvider.ts:543` — existing CSP construction. The same pattern applies to all Switchboard webviews.

---

## MAJOR

### M1 — No state management for the Review Webview Panel lifecycle
VS Code WebviewPanels can be disposed, hidden, and restored. The plan has no mention of `retainContextWhenHidden`, panel disposal handlers, or what happens when the user closes the plan and reopens it. `KanbanProvider.ts:31-56` shows the minimal boilerplate required. None of this is addressed.

### M2 — "Submit Comment → sends a message to the active terminal/agent" is hand-waving
How does the extension know which terminal is "active" for comment routing? The Switchboard state model uses a role-based registry (`state.json`, `registeredTerminals` Map in `extension.ts:103`). There is no "currently active agent" concept. The plan implies a simple click-to-chat, but the actual plumbing requires:
1. Identifying the correct agent terminal from `state.json`
2. Formatting the comment with the selected text and file reference
3. Calling `sendRobustText` or the inbox mechanism to dispatch it

None of this is designed.

### M3 — Adding `marked` as a runtime dependency conflicts with the existing sanitisation stack
The `package.json` already includes `dompurify` and `jsdom` as dependencies. The plan introduces yet another markdown processing tool without rationalising the existing stack. This is dependency sprawl.

### M4 — The automated test mentioned is not real
"Add a new test in `coder-reviewer-workflow.test.js`" — that file tests workflow routing, not UI interactions. You cannot meaningfully unit-test a webview comment submission in a headless test runner without full VS Code test infrastructure. The plan provides no test strategy that could actually be executed.

### M5 — No mention of how the "Review" feature is exposed to the user
The Kanban card currently has three buttons: `Copy Prompt`, `View`, `Complete`. Adding "Review" requires a fourth button — but the plan doesn't mention modifying `kanban.html` at all. How does the user even get to the new Review view? Via the existing "View" button? A new button? A right-click context menu? This is the entry point for the entire feature and it is completely absent from the plan.

---

## NIT

### N1 — Output paths for review artifacts are named after the `challenge` workflow defaults, not the plan project
`.switchboard/reviews/grumpy_critique.md` is the default review path for the *challenge workflow*, not for the new feature's own reviewer functionality. Naming is confusing.

### N2 — "replicate 'Review' Feature" is not a good plan title
Capitalisation inconsistent. Not actionable. Should be "Implement Plan Review Webview with Contextual Commenting."
