# Adjust airlock tab text

## Goal
Why does the airlock tab text for number 1 say ' Configure the workspace files you want to bundle.'. Thre's no configuration option! This sentence should be removed. 

## Proposed Changes

### Step 1: Remove the misleading configuration sentence
**File:** `src/webview/implementation.html` — `createAutobanPanel()` or the Airlock panel creation function (around line 2735)

The Step 1 description text is created at approximately line 2735–2736:
```javascript
s1Desc.innerText = 'Package code into docx files for NotebookLM compatibility. Configure the workspace files you want to bundle.';
```

**Change to:**
```javascript
s1Desc.innerText = 'Package code into docx files for NotebookLM compatibility.';
```

Simply remove the second sentence "Configure the workspace files you want to bundle." since there is no configuration UI for selecting which files to bundle.

### Step 2: Verify no other references to file configuration
**File:** `src/webview/implementation.html`

Search for any other text that mentions "configure" or "workspace files" in the Airlock tab section. Ensure no other misleading text remains.

## Verification Plan
- Open the Airlock tab in the sidebar.
- Confirm Step 1 text reads "Package code into docx files for NotebookLM compatibility." without the configuration sentence.
- Confirm no other text references file configuration that doesn't exist.

## Open Questions
- Should a file configuration feature be added in the future (making the text accurate rather than removing it)?

## Complexity Audit
**Band A (Routine)**
- Single string edit in a single file.
- No logic changes, no backend changes.
- Extremely low risk.

## Dependencies
- **Related to:** `feature_plan_20260311_083115_rewrite_airlock_tab_text.md` — that plan rewrote the airlock tab text but apparently left this sentence in. This is a follow-up correction.
- No conflicts.

## Adversarial Review

### Grumpy Critique
1. "This is a one-line string edit. Does it really need a feature plan?"

### Balanced Synthesis
1. **Valid — but it's in the pipeline, so improve it properly.** The plan is minimal but complete. It documents the exact file and line, which makes the coder's job trivial.

## Agent Recommendation
**Coder** — One-line string edit. Trivial.
