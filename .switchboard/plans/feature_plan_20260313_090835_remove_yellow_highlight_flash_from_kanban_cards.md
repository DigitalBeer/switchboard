# Remove highlight flash from Kanban cards

## Goal
Remove the jarring color flash from Kanban cards during the completion animation to maintain a consistent dark-themed, industrial aesthetic.

## User Review Required
> [!NOTE] 
> This is a purely visual UI CSS change in the Kanban webview. No backend logic or orchestration behavior is altered.

## Complexity Audit
### Band A — Routine
- Modifying the `@keyframes cardComplete` CSS animation steps in `src/webview/kanban.html`.

### Band B — Complex / Risky
- None. This is an isolated presentation-layer update.

## Edge-Case Audit
- **Race Conditions:** None. This is a static CSS keyframe animation.
- **Security:** None.
- **Side Effects:** Stripping the color change removes a visual indicator of state transition. However, the existing scale and opacity transformations are sufficient to communicate that the card is being dismissed.

## Adversarial Synthesis
### Grumpy Critique
If you remove the background color flash, the user loses a massive visual cue that the card was actually processed and isn't just randomly disappearing due to a UI bug! The "pop" scale effect alone isn't enough to convey "success"; it just looks like the card is glitching out. Why not change it to a subtle green instead of removing it entirely?

### Balanced Response
Grumpy highlights the importance of state-change feedback. However, Kanban cards moving across the board already provide strong spatial feedback. When a card completes, it physically slides away and disappears from the active view. In a dark-themed UI, sudden flashes of background color—even subtle ones—can be extremely fatiguing during batch operations where multiple cards are completing in rapid succession. The scale "pop" is a sufficient, non-fatiguing physical indicator that the action was intentional.

## Proposed Changes

### Kanban Webview
#### [MODIFY] `src/webview/kanban.html`
- **Context:** The `cardComplete` animation in the webview currently overrides the card's background with a 20% teal mix at the 40% mark.
- **Logic:** We will strip the color property shifts from the animation keyframe to keep the background consistent with the dark theme.
- **Implementation:** Update the `@keyframes cardComplete` block to remove `background` and `border-color` at `40%`.
- **Edge Cases Handled:** Leaves the scale transformation in place to maintain the physical motion curve.

## Verification Plan

### Automated Tests
- None required for this CSS change.

### Manual Testing
1. Open the CLI-BAN board via the Switchboard sidebar.
2. Click the **Complete** icon button on any existing card.
3. Verify that the card scales up slightly, then shrinks and fades out smoothly **without** any bright teal/yellow color flashing on the background or border.

***

## Appendix: Implementation Patch

Apply the following patch to `src/webview/kanban.html`:

```diff
--- src/webview/kanban.html
+++ src/webview/kanban.html
@@ -... +... @@
 /* Card Complete / Delete Animation */
 
 @keyframes cardComplete {
 
 0% { transform: scale(1); opacity: 1; }
 
-40% { transform: scale(1.05); opacity: 0.9; background: color-mix(in srgb, var(--accent-teal) 20%, var(--panel-bg)); border-color: var(--accent-teal); }
+40% { transform: scale(1.05); opacity: 0.9; }
 
 100% { transform: scale(0.8) translateX(40px); opacity: 0; padding-top: 0; padding-bottom: 0; margin: 0; height: 0; border-width: 0; }
 
 }
```

Would you like me to dispatch this plan to the Lead Coder agent so they can implement these animation changes?