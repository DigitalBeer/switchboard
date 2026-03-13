# Task Tracking

- [x] Read `accuracy.md`, `.agent/rules/WORKFLOW_INTEGRITY.md`, `.agent/rules/switchboard_modes.md`, the plan file, and the target webview file.
- [x] Update the Kanban subheader string in `src/webview/kanban.html`.
- [x] Run verification command (`npm run lint`).
- [x] Read back the modified line to confirm correctness.
- [x] Perform red-team self-review with line references.
- [x] Run final verification and diff review.

### Detailed Plan

1. Inspect `src/webview/kanban.html` to confirm the current `.kanban-title` string.
2. Replace the `.kanban-title` text with the expanded cross-IDE copy prompt string from the plan.
3. Run `npm run lint` as the verification gate for the HTML string change.
4. Read back the edited line in `src/webview/kanban.html` and confirm the string matches the plan exactly.
5. Red-team review the modified file and document failure modes with line references.
6. Run final verification and review the diff for only the expected string change.

### Dependencies

- `src/webview/kanban.html` is loaded into the Kanban webview and is the only source of the header string.

### Risks

- Longer header text could wrap at narrow widths and crowd the Refresh button.

### Verification Plan

- Run `npm run lint`.
- Read back the updated `.kanban-title` line in `src/webview/kanban.html`.
- Review the diff for only the expected string change.

### Dependency Map

- Step 2 depends on Step 1 confirming the existing string.
- Step 3 depends on Step 2 completing the edit.
- Step 4 depends on Step 3 passing.

### Verification Record

- `npm run lint` failed: ESLint v9 expects `eslint.config.*` (no config present).
- `npm run compile` failed due to pre-existing parse errors in `src/services/TaskViewerProvider.ts` (TS1011/TS1127).
- Final `npm run compile` failed with the same `TaskViewerProvider.ts` parse errors.
- Readback confirmed the updated `.kanban-title` line in `src/webview/kanban.html:443`.
- Diff review shows only `src/webview/kanban.html` and `task.md` modified.

### Red Team Findings

- `src/webview/kanban.html:42-57, 443`: The longer title plus `justify-content: space-between` can compress or push the Refresh button offscreen at narrow widths because the header lacks wrapping or overflow control.
- `src/webview/kanban.html:105-110, 443`: If the header wraps to two lines, the board height still assumes a 50px header and can clip content or add unexpected scroll.
- `src/webview/kanban.html:51-57, 443`: The uppercase mono styling with added length may reduce legibility and cause the header text to visually dominate, masking the Refresh button in small panels.
- `task.md:3-6`: Checkboxes marked complete can be misread as successful verification even though lint/compile failed.
- `task.md:10-17`: The plan steps do not explicitly gate execution on successful verification, so readers might gloss over the failure and proceed.
- `task.md:39-43`: The verification record can become stale if line numbers or error outputs change, creating a false sense of accuracy.
