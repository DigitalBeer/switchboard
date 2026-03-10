# Add Tactile Animations to Kanban Board

## Goal
Add high-polish CSS animations to the Kanban board for dropping cards into new columns and completing tasks, creating a highly tactile and visually rewarding experience suitable for marketing material.

## User Review Required
> [!NOTE]
> This will introduce a 400ms delay between a user dropping a card or clicking "Complete" and the actual backend message being sent, ensuring the animation has time to play before the DOM is re-rendered.

## Complexity Audit
### Band A — Routine
- Adding `@keyframes` to `src/webview/kanban.html`.
- Adding temporary classes during the `handleDrop` event.
### Band B — Complex / Risky
- Decoupling the "Complete" button's click event and the "Drop" event from their immediate `vscode.postMessage` to allow the exit/drop animations to finish before the board re-renders.

## Edge-Case Audit
- **Race Conditions:** If a backend refresh occurs naturally (via file watcher) *during* the 400ms animation, the card will instantly vanish or lose its animation. This is acceptable as it's a rare visual glitch, not a state corruption.
- **Security:** None. Purely visual CSS/JS changes.
- **Side Effects:** Double-clicking "Complete" while the animation is playing could send duplicate completion messages. We must disable pointer events on the card once the animation starts.

## Adversarial Synthesis
### Grumpy Critique
You caught the race condition for the 'Complete' button but completely missed it for the drop animation! When you drop a card, `handleDrop` immediately sends a `triggerAction` message to the backend. The backend updates the run sheet and triggers a board refresh (`updateBoard`), which wipes the DOM and re-renders everything. Your 400ms pulse animation will be blown away the second the backend responds! You need to delay the `triggerAction` message just like you did for the 'Complete' button.

### Balanced Response
Grumpy makes an excellent point. The `triggerAction` IPC message fired during `handleDrop` will cause the backend to emit an `updateBoard` message back to the webview, rebuilding the DOM and killing the `.card-dropped` animation prematurely. Applying the same 350ms optimistic UI delay before dispatching `triggerAction` is the simplest, most consistent way to ensure the pulse animation finishes before the DOM is re-rendered.

## Proposed Changes

### 1. Webview CSS
#### [MODIFY] `src/webview/kanban.html`
Add the following keyframes and classes to the `<style>` block:
```css
/* Card Drop Animation */
@keyframes dropPulse {
    0% { transform: scale(1.05); box-shadow: 0 4px 20px var(--accent-teal); }
    100% { transform: scale(1); box-shadow: 0 4px 12px color-mix(in srgb, var(--accent-teal) 20%, transparent); }
}
.card-dropped {
    animation: dropPulse 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
}

/* Card Complete / Delete Animation */
@keyframes cardComplete {
    0% { transform: scale(1); opacity: 1; }
    40% { transform: scale(1.05); opacity: 0.9; background: color-mix(in srgb, var(--accent-teal) 20%, var(--panel-bg)); border-color: var(--accent-teal); }
    100% { transform: scale(0.8) translateX(40px); opacity: 0; padding-top: 0; padding-bottom: 0; margin: 0; height: 0; border-width: 0; }
}
.card-completing {
    animation: cardComplete 0.4s ease-out forwards;
    pointer-events: none;
    overflow: hidden;
}
```

### 2. Webview JavaScript
#### [MODIFY] `src/webview/kanban.html`
**Change 1:** Update the `Complete` button listener inside `renderBoard()`.
*Find:*
```javascript
document.querySelectorAll('.card-btn.complete').forEach(btn => {
    btn.addEventListener('click', () => {
        vscode.postMessage({ type: 'completePlan', sessionId: btn.dataset.session });
    });
});
```
*Replace with:*
```javascript
document.querySelectorAll('.card-btn.complete').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const cardEl = e.target.closest('.kanban-card');
        if (cardEl) {
            // Optimistic UI: Animate out before sending to backend
            cardEl.classList.add('card-completing');
            setTimeout(() => {
                vscode.postMessage({ type: 'completePlan', sessionId: btn.dataset.session });
            }, 350); // Slightly less than 400ms to ensure smooth handoff to the backend redraw
        } else {
            // Fallback if DOM traversal fails
            vscode.postMessage({ type: 'completePlan', sessionId: btn.dataset.session });
        }
    });
});
```

**Change 2:** Update `handleDrop()` to trigger the pulse animation and delay the `triggerAction` message.
*Find:*
```javascript
if (emptyState) emptyState.remove();
targetBody.appendChild(cardEl);
```
*And find the subsequent postMessage:*
```javascript
// Post message to extension to trigger the appropriate agent
vscode.postMessage({
    type: 'triggerAction',
    sessionId: sessionId,
    targetColumn: targetColumn
});
```
*Replace the entire block with:*
```javascript
if (emptyState) emptyState.remove();
targetBody.appendChild(cardEl);

// Trigger drop animation
cardEl.classList.remove('card-dropped'); 
void cardEl.offsetWidth; // Trigger reflow to restart animation
cardEl.classList.add('card-dropped');
cardEl.addEventListener('animationend', () => {
    cardEl.classList.remove('card-dropped');
}, { once: true });

// Optimistic UI: Delay backend update so animation finishes before DOM is wiped
setTimeout(() => {
    vscode.postMessage({
        type: 'triggerAction',
        sessionId: sessionId,
        targetColumn: targetColumn
    });
}, 350);
```

## Verification Plan
### Automated Tests
- No new automated tests required for purely visual Webview transitions.
### Manual Testing
- [ ] Compile the extension and open the CLI-BAN board.
- [ ] Drag a card from "Created" to "Coded". Verify the card slightly scales up and pulses with a teal glow as it snaps into the new column.
- [ ] Verify the backend starts the agent action *after* the animation plays.
- [ ] Click "Complete" on a card. Verify the card slightly pops out, flashes teal, and then smoothly shrinks and slides to the right into nothingness before the board refreshes.
- [ ] Verify the backend successfully receives the `completePlan` message after the animation finishes and the card is actually archived.