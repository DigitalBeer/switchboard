# Fix MCP Recheck Button CSP Blocking

## Goal
Fix the MCP recheck button in the implementation panel that is currently non-functional due to CSP blocking its inline `onclick` handler.

## Background
The Database & Sync panel had the same issue (fixed in `feature_plan_20260328_175526_atabase_sync_panel_is_unresponsive.md`). The MCP recheck span at `implementation.html:1792` has an inline `onclick="vscode.postMessage(...)"` attribute that is blocked by the Content-Security-Policy header which uses `script-src 'nonce-...'` without `'unsafe-inline'`.

The button appears clickable but does nothing when clicked. This is a silent failure that degrades UX.

## Implementation

### 1. Add ID attribute to the span
**File:** `src/webview/implementation.html`

Change line 1792 from:
```html
<span id="mcp-recheck" title="Recheck MCP connection"
    style="cursor:pointer; margin-left:4px; opacity:0.6; font-size:11px;"
    onclick="vscode.postMessage({ type: 'recheckMcpConnection' })">&#x21bb;</span>
```

To:
```html
<span id="mcp-recheck-btn" title="Recheck MCP connection"
    style="cursor:pointer; margin-left:4px; opacity:0.6; font-size:11px;">&#x21bb;</span>
```

Note: Remove the `onclick` attribute, change `id` from `mcp-recheck` to `mcp-recheck-btn` for clarity.

### 2. Add event listener registration
**File:** `src/webview/implementation.html`

In the script section where other event listeners are registered (near the other `addEventListener` calls for the Database & Sync panel, around line 3968+), add:

```javascript
document.getElementById('mcp-recheck-btn')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'recheckMcpConnection' });
});
```

### 3. Verify backend handler exists
**File:** `src/services/ImplementationProvider.ts` (or wherever `recheckMcpConnection` is handled)

Confirm that the message handler for `recheckMcpConnection` still exists and functions correctly. This handler was working before the CSP change broke the button trigger.

## Verification Plan

### Manual Verification
1. Open Switchboard implementation panel
2. Look at the MCP status line (should show "CHECKING", "CONNECTED", or similar)
3. Click the ↻ (recheck) icon next to the MCP status
4. **Expected:** The MCP status should briefly show "CHECKING" again, then update to current status
5. **Failure mode:** If broken, clicking does nothing (no visual feedback, no status change)

### Build Verification
- Run `npm run compile` — no TypeScript errors
- Run `npx tsc --noEmit` — no type regressions

## Complexity
- **Scope:** 1 file (`implementation.html`), 2 small edits
- **Risk:** Low — same fix pattern already validated for 11 buttons in the Database & Sync panel
- **Dependencies:** None

## Adversarial Considerations
- **What could go wrong:** 
  - If the backend `recheckMcpConnection` handler was removed or renamed, the button will appear to work but backend will ignore the message
  - If the element ID is mistyped, the event listener won't attach and button stays broken
- **How to verify:** Manual click test is sufficient; no silent failures possible (either works or doesn't)

## Agent Recommendation
**Send to Coder** — Single file, well-defined scope, established pattern from previous fix. No architectural decisions required.

## Reviewer Pass — 2026-03-29

### Findings Summary

| ID | Severity | File:Line | Finding | Verdict |
|----|----------|-----------|---------|---------|
| R1 | ✅ PASS | `implementation.html:1774-1775` | Inline `onclick` removed, ID changed to `mcp-recheck-btn` | Correct |
| R2 | ✅ PASS | `implementation.html:2103-2105` | `addEventListener('click', ...)` registered with `vscode.postMessage({ type: 'recheckMcpConnection' })` | Correct |
| R3 | ✅ PASS | `TaskViewerProvider.ts:2964-2965` | Backend handler dispatches `switchboard.recheckMcp` command | Correct |
| R4 | ✅ PASS | `TaskViewerProvider.ts:9252-9260` | CSP nonce generation + injection is solid | Correct |
| R5 | ✅ PASS | All webview files | Zero inline HTML event handler attributes (`onclick=`, `onchange=`, etc.) | Correct |
| R6 | NIT | `implementation.html` (12 sites) | `.onclick = () => {}` JS property assignments mixed with `addEventListener` style — inconsistent but CSP-safe | Defer |
| R7 | NIT | `TaskViewerProvider.ts:9270` | Error fallback HTML interpolates `${e}` unsanitized, no CSP on error page — pre-existing, not introduced by this fix | Defer |

### Files Changed (by this reviewer pass)

- **None** — No code changes required. Implementation is correct.

### Validation Results

- `npx tsc --noEmit` — ✅ **PASS** (exit code 0, no errors)
- Inline event handler audit — ✅ **ZERO** `onclick="..."` HTML attributes across all webview files
- CSP nonce injection — ✅ Regex `/<script>/g` correctly matches the single bare `<script>` tag at line 1826
- Backend handler — ✅ `recheckMcpConnection` case exists and dispatches correct VS Code command

### Remaining Risks

1. **Low**: 12 `.onclick =` JS property assignments (lines 2002, 2008, 2954, 2968, 2992, 3025, 3208, 3235, 3245, 3267, 3773, 3800) are CSP-safe but stylistically inconsistent with `addEventListener`. No functional risk — defer to a future cleanup sweep.
2. **Low**: Error fallback HTML at `TaskViewerProvider.ts:9270` has no CSP and unsanitized error interpolation. Pre-existing issue, not introduced by this fix. Practical risk is minimal (error is from filesystem operations, webview is sandboxed).

### Reviewer Verdict

**✅ APPROVED** — The MCP recheck button CSP fix is correctly implemented. The inline `onclick` was removed, `addEventListener` was added following the established project pattern, and the backend handler is intact. No CRITICAL or MAJOR findings.
