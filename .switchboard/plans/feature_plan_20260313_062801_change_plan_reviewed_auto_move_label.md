# Change plan reviewed auto-move label

Update the labels in the Kanban column headers to better describe the automated actions associated with each column.

## 📊 Complexity Audit
- **Band A (Routine)**: UI label updates in `kanban.html`.

## 🛡️ Structural Audit
- **Layout Consistency**: Ensure the new labels do not cause overflow or misalignment in the column headers.
- **Translation/Hardcoding**: Text is currently hardcoded in the HTML; no localization system observed in `kanban.html`.

## Adversarial Synthesis

### Grumpy Critique
If you change these labels to longer phrases like "Dynamic-route every", they might overflow on smaller screens or cause alignment issues in the Kanban columns. Also, "Auto-plan every" is confusing terminology for end users. 

### Balanced Response
Grumpy's point about text overflow is valid. We must ensure the CSS for `auto-move-bar` handles text overflow gracefully (e.g. text-overflow: ellipsis). We will proceed with the label updates but explicitly verify the responsive layout during manual testing. The terminology, while slightly awkward, matches the updated workflow language.

## Proposed Changes

### Kanban Webview

#### [MODIFY] [kanban.html](file:///c:/Users/patvu/Documents/GitHub/switchboard/src/webview/kanban.html)
Update the text content of the labels in the `auto-move-bar` (lines 460-515) for each column:
- `CREATED` column: Change "Auto-move every" to "Auto-plan every".
- `PLAN REVIEWED` column: Change "Auto-move every" to "Dynamic-route every".
- `CODED` column: Change "Auto-move every" to "Auto-review every".

## Verification Plan

### Manual Verification
1. Open the Kanban board.
2. Verify that the labels in each column's "Auto-move" bar have been updated correctly.
3. Ensure the layout remains clean and no text is truncated when the labels change.
