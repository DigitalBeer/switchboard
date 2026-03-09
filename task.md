# Task: Remove Excessive Sidebar Colored Strips

- [x] [IMPLEMENTATION] Remove `border-left` and related overrides in `src/webview/implementation.html`
    - [x] Line ~191: `.activity-row { border-left: ... }`
    - [x] Line ~240: `.activity-row.summary { border-left-color: ... }`
    - [x] Line ~258: `.agent-row { border-left: ... }`
    - [x] Line ~263: `.agent-row:has(.status-dot.green) { border-left-color: ... }`
    - [x] Line ~269: `.agent-row:has(.status-dot.green-pulse) { border-left-color: ... }`
    - [x] Line ~275: `.agent-row:has(.status-dot.red) { border-left-color: ... }`
- [x] [VERIFICATION] Confirm visual hierarchy via status-dots and background tints
- [x] [VERIFICATION] Confirm Kanban cards still have vertical teal strips
- [x] [FINAL] ACCURACY VERIFICATION COMPLETE

## Dependency Analysis
Purely CSS/Visual change. No code dependencies identified. Risks are minimal (minor visual hierarchy change).
