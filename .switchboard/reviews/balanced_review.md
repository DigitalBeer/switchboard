# Balanced Review: Airlock Tab Bug Fix Plan

**Reviewer**: Lead Developer (synthesis & mediation)
**Grumpy critique**: `.switchboard/reviews/grumpy_critique.md`

---

## Summary of Review

The plan is directionally correct. It identifies the right 4 bugs and the right two files. However, it is underspecified on the two most complex fixes (bugs #2 and #3), and the Grumpy reviewer has surfaced a real race condition and a half-baked payload fix. The layout fix (bug #4) is simple but needs a one-line addition to handle narrow panel widths.

**Status**: Approved to proceed with revisions outlined below.

---

## Valid Concerns

### ✅ Critical #1 — Payload Must Be File-Path-Only (Verified)
The bug report is confirmed: `payload` at `TaskViewerProvider.ts:6269` contains `${text}` which is piped directly to terminal stdin via `sendRobustText`. This is a verified overflow path. The fix must ensure the payload dispatched to `_dispatchExecuteMessage` is *only* the instruction + file path — no raw text content whatsoever.

### ✅ Critical #2 — Textarea Stabilization Needs a Concrete Strategy
The plan's description ("check if the panel exists") is not sufficient. The only bulletproof approaches are:
- **(Preferred)** Skip rebuilding `agentListWebai` content if `document.getElementById('airlock-textarea')` exists **and** `document.activeElement` is within `agentListWebai` (i.e., the user is actively interacting).
- **(Alternative)** Move the Airlock panel out of `renderAgentList()` entirely and render it once at init, updating only the `webai-status` element via ID targeting.
The implementation spec must choose one explicitly.

### ✅ Critical #3 — Race Condition on Clear Is Real but Manageable
The race condition between the plan-watcher-triggered re-render and the `airlock_planSaved` message is real. The fix: clear `_airlockTextareaValue = ''` **before** posting the message to the backend (optimistic clear on button click), not in response to the success message. If the backend fails, restore the value via the error path. This is simpler and avoids the race entirely.

### ✅ Major #4 — Add a Size Guard Before `writeFile`
A max size check (e.g., 2MB) before writing to disk is a 2-line addition that prevents pathological behavior. Worth including.

---

## Action Plan

| # | Priority | Action | Location |
|---|----------|--------|----------|
| A | Required | In `_handleAirlockSendToCoder`: change payload to only contain instruction + `patchPath`. Never include `text`. Same change for `_handleAirlockConvertToPlan` if it ever sends anything. | `TaskViewerProvider.ts:6269` |
| B | Required | Add `MAX_AIRLOCK_TEXT_BYTES = 2 * 1024 * 1024` guard before `writeFile` in both handlers. Return an error message to the webview if exceeded. | `TaskViewerProvider.ts:6257` |
| C | Required | Textarea clear: call `_airlockTextareaValue = ''` and `textarea.value = ''` **on button click** (optimistic), before posting the message. Restore on error. Do not wait for `airlock_planSaved`. | `implementation.html:2203-2208`, `2223-2228` |
| D | Required | Choose a specific textarea stabilization strategy. Recommended: skip `agentListWebai.innerHTML = ''` + full reconstruction when `document.getElementById('airlock-textarea')` exists and airlock tab is active. Only rebuild if the airlock tab is not shown. | `implementation.html:2047` |
| E | Recommended | Change dispatch priority to `leadAgent || coderAgent` (Lead first). | `TaskViewerProvider.ts:6262` |
| F | Recommended | Buttons side-by-side: use `flex: 1; min-width: 0;` on each button and consider shortening labels to `PLAN` / `SEND`. | `implementation.html:2198-2230` |

---

## Dismissed Points

### ❌ NIT #7 — `_airlockTextareaValue` closure variable being "fragile"
The closure pattern is appropriate for a single-file webview with no module system. Attaching state to `dataset` would be less readable. Dismissed.

### ❌ NIT #8 — Duplicate ID risk on `webai-status`
Valid defensively, but once fix D is implemented, `createWebAiAirlockPanel()` will only be called once. Tracking a potential future problem is not worth spec complexity now. Dismissed.

### ❌ MAJOR #5 — Agent priority ordering
The current priority (`coder || lead`) is arguably a user preference concern, not a critical bug. The Lead Coder in some setups is intentionally hands-off. Flagged as Recommended, not Required.
