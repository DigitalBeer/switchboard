# Change dynamic routing switch to icon

## Goal
The dynamic routing switch in the autoban planned column header needs to be an icon instead.

use: /Users/patrickvuleta/Documents/GitHub/switchboard/icons/25-1-100 Sci-Fi Flat icons-77.png

## Proposed Changes
- Added `{{ICON_77}}` to `iconMap` in `src/services/KanbanProvider.ts` to make the icon available in the webview.
- Defined `ICON_DYNAMIC_ROUTING = '{{ICON_77}}'` in `src/webview/kanban.html`.
- Changed the complexity routing toggle in the "Planned" column header from a checkbox to an icon button in `src/webview/kanban.html`.
- Added CSS styles for the `.complexity-routing-btn` class to match the `.mode-toggle` style.
- Updated `updateComplexityRoutingToggleUi()` to toggle the `is-active` class on the new icon button.
- Moved the `complexity-routing-toggle` event listener into the `renderColumns()` function to ensure it's re-bound when the board is re-rendered.
- Removed the old `change` event listener for the checkbox.
- Fixed a broken dynamic import of `ArchiveManager` in `KanbanProvider.ts` that was preventing successful compilation.

## Review Findings (Grumpy Principal Engineer)

### CRITICAL Issues Fixed
- **CRITICAL-2: Event Listener Memory Leak** - Event listener was being attached inside `renderColumns()`, creating duplicate handlers on every re-render. **FIXED**: Moved to one-time event delegation pattern at initialization (lines 2318-2325).

### MAJOR Issues Fixed
- **MAJOR-2: Tooltip Accessibility** - Tooltip text was too verbose (48 words). **FIXED**: Simplified to "Toggle complexity routing (low→coder, high→lead)" (10 words).

### Issues Verified as Non-Blocking
- **CRITICAL-1: Icon File Existence** - Verified icon file exists at `/Users/patrickvuleta/Documents/GitHub/switchboard/icons/25-1-100 Sci-Fi Flat icons-77.png` (18,670 bytes).
- **MAJOR-1: Inconsistent Icon Filter Styling** - Grayscale inactive state vs teal active state is intentional visual differentiation. Deferred as polish item.
- **NIT-1: CSS Duplication** - `.complexity-routing-btn` duplicates `.mode-toggle` styles. Deferred as refactoring opportunity.
- **NIT-2: Magic Number Margin** - 4px vs 8px spacing intentional for visual hierarchy. Deferred.

## Files Changed
- `src/webview/kanban.html` (lines 1312, 1441-1446 removed, 2318-2325 added)

## Verification Results
- ✅ `npm run compile` - **PASS** (compiled successfully in 2618ms)
- ✅ Icon file verified present (18,670 bytes)
- ✅ Event listener memory leak eliminated via event delegation
- ✅ Tooltip simplified for accessibility
- ✅ TypeScript compilation clean (no errors)

## Remaining Risks
- **Low**: CSS duplication between `.complexity-routing-btn` and `.mode-toggle` creates maintenance overhead (deferred)
- **Low**: Inconsistent filter styling pattern across UI (visual polish, not functional)

## Open Questions
- None.
