# Fix Google Drive "Open in Finder" to Open My Drive Folder

## Problem

When users select Google Drive as their database location and the `Switchboard` folder doesn't exist, clicking "Open in Finder" opens the Google Drive root folder (`~/Library/CloudStorage/GoogleDrive-*/`) instead of the "My Drive" subfolder. Users cannot create new folders in the root - they can only create folders within "My Drive".

## Root Cause

The code was opening `path.dirname(parentDir)` which resolves to the Google Drive root. On Google Drive, user-writable content lives in the "My Drive" subfolder, not the root.

## Solution

For Google Drive paths specifically, detect if the path is Google Drive and open "My Drive" instead of the root folder.

## Changes Made

### MODIFY `src/services/TaskViewerProvider.ts`

**Location:** Lines 3614-3626 in the `setPresetDbPath` case handler

**Before:**
```typescript
if (choice === 'Open in Finder') {
    // grandparentDir is the parent of the missing folder (e.g. GoogleDrive root, ~/Dropbox)
    const grandparentDir = path.dirname(parentDir);
    if (fs.existsSync(grandparentDir)) {
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(grandparentDir));
    }
```

**After:**
```typescript
if (choice === 'Open in Finder') {
    // For Google Drive on macOS, user needs to create folder in "My Drive", not the root
    const grandparentDir = path.dirname(parentDir);
    let openDir = grandparentDir;
    if (parentDir.toLowerCase().includes('googledrive')) {
        const myDrivePath = path.join(grandparentDir, 'My Drive');
        if (fs.existsSync(myDrivePath)) {
            openDir = myDrivePath;
        }
    }
    if (fs.existsSync(openDir)) {
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(openDir));
    }
```

## Behavior Change

| Scenario | Before | After |
|----------|--------|-------|
| Google Drive preset, folder missing | Opens root folder (can't create folders) | Opens "My Drive" folder (can create folders) |
| Dropbox preset, folder missing | Opens Dropbox root | Unchanged (Dropbox allows root folder creation) |
| iCloud preset, folder missing | Opens iCloud root | Unchanged |

## Verification

1. Clear any existing `~/Library/CloudStorage/GoogleDrive-*/Switchboard` folder
2. Open Switchboard database settings
3. Select "Google Drive" preset
4. Click "Open in Finder" when prompted
5. Verify Finder opens to "My Drive" instead of the Google Drive root
6. Create the "Switchboard" folder
7. Click "Continue" and verify database location is set

## Files Modified

- `src/services/TaskViewerProvider.ts` — Modified "Open in Finder" handler to open "My Drive" for Google Drive paths
- `src/services/TaskViewerProvider.ts` — Fixed preset path to include `My Drive` component (line 3570)

## Review Results (2026-03-31)

### Issues Found
- **CRITICAL (Fixed)**: Preset path was `path.join(cloudStorage, gdEntry, 'Switchboard', 'kanban.db')`, missing the `My Drive` segment. The "Open in Finder" fix correctly directed users to `My Drive`, but the subsequent "Continue" check verified existence of `GoogleDrive-.../Switchboard` (not `My Drive/Switchboard`). Result: users who created the folder as instructed would still get "Folder still not found" error.
- **MAJOR (Deferred)**: `googledrive` string match applied to `parentDir` could theoretically match custom paths with 'googledrive' in them. Low blast radius; not fixed.

### Fix Applied
Updated line 3570:
```typescript
// Before:
presetPath = path.join(cloudStorage, gdEntry, 'Switchboard', 'kanban.db');
// After:
presetPath = path.join(cloudStorage, gdEntry, 'My Drive', 'Switchboard', 'kanban.db');
```

### Validation
- `npx tsc --noEmit`: only pre-existing KanbanProvider.ts error (false positive), no new errors introduced.
- End-to-end flow verified: preset path → parentDir check → Open in Finder → user creates folder → Continue succeeds.

### Remaining Risks
- The `googledrive` substring check in the Open in Finder handler is slightly imprecise (could match non-GDrive paths). Low probability in practice.
- Fallback preset path (for legacy `~/Google Drive` installations) lacks `My Drive` but is unused on modern macOS setups and untouched by this PR.
