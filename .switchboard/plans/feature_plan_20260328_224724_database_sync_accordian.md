# Database & Sync accordion styling fixes

## Goal
Align the "DATABASE & SYNC" accordion with the styling of other accordions in the sidebar (TERMINAL OPERATIONS, SETUP).

## Metadata
**Tags:** frontend, UI
**Complexity:** Low

## Edge-Case & Dependency Audit
- **Race Conditions:** None. Pure CSS and HTML text changes.
- **Security:** None. No user input or dynamic content.
- **Side Effects:** Existing JavaScript event listeners on `#db-sync-toggle-btn` and `#db-sync-chevron` will continue to work since we're only changing CSS classes and text, not IDs.
- **Dependencies & Conflicts:** No conflicts detected. This plan is isolated to UI styling. Potential overlap with `database_sync_panel_improvements.md` which also modifies the same panel, but that plan focuses on button functionality, not accordion styling.

## Adversarial Synthesis

### Grumpy Critique
"Oh, wonderful. Another cosmetic change that'll break the moment someone touches the JavaScript. You're swapping CSS classes without verifying that the event handlers are ID-based or class-based. What if `.db-sync-toggle` has specific event delegation logic? And 'Database operations' is generic garbage—what operations? Sync? Backup? Export? The original 'DATABASE & SYNC' was at least descriptive. Also, you're assuming the chevron character is the only difference. What about font size? Color? Rotation angle when expanded? You're going to end up with a half-styled accordion that looks like a Frankenstein monster."

### Balanced Response
Grumpy's concerns about event handlers are valid but mitigated: the JavaScript uses ID selectors (`#db-sync-toggle-btn`, `#db-sync-chevron`), not class selectors, so changing CSS classes won't break functionality. The chevron styling is already defined in the `.panel-toggle .chevron` CSS rule (lines 713-721 in implementation.html), which handles font size (10px), color (var(--text-secondary)), and rotation transform. The rename to "Database operations" follows the established pattern of "TERMINAL OPERATIONS" which is also a high-level category label. We'll verify all styling properties match after the change.

## Proposed Changes

> [!IMPORTANT]
> **MAXIMUM DETAIL REQUIRED:** Complete implementation with exact line changes and verification steps.

### Target File: `/Users/patrickvuleta/Documents/GitHub/switchboard/src/webview/implementation.html`

#### [MODIFY] HTML Structure (lines 1707-1712)

**Context:** The DATABASE & SYNC section currently uses custom classes `.db-sync-toggle` and `#db-sync-section` wrapper, which don't inherit the standard accordion styling used by TERMINAL OPERATIONS and SETUP sections.

**Logic:**
1. Wrap the entire section in a `.system-section` div (like TERMINAL OPERATIONS at line 1601)
2. Change `.db-sync-toggle` to `.panel-toggle` to inherit standard accordion styling
3. Update text from "DATABASE & SYNC" to "Database operations" for consistency
4. Remove inline `style="margin:0"` if needed (the `.panel-toggle .section-label` already handles this)

**Implementation:**

**OLD (lines 1707-1712):**
```html
        <!-- DATABASE & SYNC -->
        <div id="db-sync-section">
            <div class="db-sync-toggle" id="db-sync-toggle-btn">
                <div class="section-label">DATABASE & SYNC</div>
                <span class="chevron" id="db-sync-chevron">▶</span>
            </div>
```

**NEW:**
```html
        <!-- DATABASE & SYNC -->
        <div class="system-section">
            <div class="panel-toggle" id="db-sync-toggle-btn">
                <div class="section-label" style="margin:0">Database operations</div>
                <span class="chevron" id="db-sync-chevron">▶</span>
            </div>
```

**Edge Cases Handled:**
- Event listeners remain functional (ID-based selectors unchanged)
- Chevron rotation animation inherited from `.panel-toggle .chevron` CSS
- Left padding/margin inherited from `.system-section` (10px padding per line 697)

#### [MODIFY] CSS Cleanup (lines 1192-1207)

**Context:** The custom `.db-sync-toggle` CSS rules are now redundant since we're using `.panel-toggle`.

**Logic:** Remove the `.db-sync-toggle` specific styling block, as it's now covered by the standard `.panel-toggle` rules (lines 705-721).

**Implementation:**

**DELETE (lines 1197-1207):**
```css
        .db-sync-toggle {
            display: flex;
            align-items: center;
            justify-content: space-between;
            cursor: pointer;
            user-select: none;
        }

        .db-sync-toggle .section-label {
            color: var(--accent-green);
        }
```

**KEEP (lines 1192-1196):** The `#db-sync-section` ID selector can be removed entirely since we're using `.system-section` class now.

**DELETE (lines 1192-1195):**
```css
        /* Database & Sync Panel */
        #db-sync-section {
            margin-top: 12px;
        }
```

**Edge Cases Handled:**
- The `.db-sync-fields` class (lines 1209-1220) remains unchanged and continues to work
- No margin-top needed since `.system-section` already has proper spacing via border-top

## Verification Plan

### Manual Visual Inspection
1. **Open the Switchboard sidebar** in VS Code
2. **Locate the "Database operations" section** (formerly "DATABASE & SYNC")
3. **Verify left padding:** The section header should have 10px left padding matching TERMINAL OPERATIONS and SETUP
4. **Verify chevron styling:**
   - Collapsed state: Small gray arrow (▶) at 10px font size, color `var(--text-secondary)`
   - Expanded state: Arrow rotates 90 degrees (pointing down)
   - Should match the chevron in TERMINAL OPERATIONS exactly
5. **Verify text:** Header reads "Database operations" (not "DATABASE & SYNC")
6. **Verify accordion behavior:** Click to expand/collapse works identically to other accordions

### Automated Tests
- No automated tests required (pure UI styling change)

### Build Verification
- Run `npm run compile` to ensure no TypeScript errors
- Reload VS Code window to see changes

## Agent Recommendation
**Send to Coder** — This is a routine HTML/CSS styling change with no complex logic.

## Complexity Audit
**Manual Complexity Override:** Low

### Routine
- Update CSS class from `.db-sync-toggle` to `.panel-toggle` to inherit existing accordion styling
- Change text content from "DATABASE & SYNC" to "Database operations"
- Replace chevron character from `▶` to match the standard chevron used in other accordions
- Update wrapper div `#db-sync-section` to use `.system-section` class for consistent padding/margin

### Complex / Risky
- None

## Reviewer Pass — 2026-03-29

### Findings Summary

| # | Severity | Finding | File:Line | Status |
|---|----------|---------|-----------|--------|
| 1 | NIT | Stale HTML comment `<!-- DATABASE & SYNC -->` didn't match new label "Database operations" | `implementation.html:1691` | **Fixed** |
| 2 | NIT | Source text "Database operations" uses mixed case while other sections use ALL CAPS ("TERMINAL OPERATIONS", "SETUP"). Visually identical due to `text-transform: uppercase` on `.section-label`. | `implementation.html:1694` | Deferred (cosmetic, CSS normalizes) |
| 3 | OBSERVATION | `.db-sync-fields` retains custom styling (backdrop-filter, border, padding:12px) rather than using `.panel-fields` (gap:6px, no border). Intentional — DB content has subsections requiring heavier chrome. | `implementation.html:1193-1208` | Accepted as-is |

### Files Changed
- `src/webview/implementation.html` — Updated stale HTML comment from `<!-- DATABASE & SYNC -->` to `<!-- DATABASE OPERATIONS -->` (line 1691)

### Validation Results
- **`npx tsc --noEmit`**: ✅ Pass (exit 0, no errors)
- **Orphan check**: No references to removed `#db-sync-section` or `.db-sync-toggle` remain in source
- **JS handler integrity**: Toggle at line 3945 uses `getElementById('db-sync-toggle-btn')` — IDs unchanged, functional

### Remaining Risks
- **Low**: Mixed-case source text is a style inconsistency but zero visual impact. Could normalize in a future cleanup pass.
- **None**: No functional, CSP, or accessibility regressions detected.
