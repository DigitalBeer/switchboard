# Fix Plan Name Extraction in Live Feed

The Live Feed logs (Recent Activity) often display raw hashes (e.g., `antigravity_<hash>`) instead of human-readable plan titles. This happens because the [SessionActionLog](file:///c:/Users/patvu/Documents/GitHub/switchboard/src/services/SessionActionLog.ts#30-768) service only scans the active `.switchboard/sessions/` directory for titles, failing to find titles for sessions that have been moved to `.switchboard/archive/sessions/` upon completion.

## Proposed Changes

### [Component Name] Switchboard Extension Core

#### [MODIFY] [SessionActionLog.ts](file:///c:/Users/patvu/Documents/GitHub/switchboard/src/services/SessionActionLog.ts)

1.  **Update `_readSessionTitleMap`**:
    -   Modify the loop to scan both `this.sessionsDir` and `path.join(path.dirname(this.sessionsDir), 'archive', 'sessions')`.
    -   Ensure it handles duplicate session IDs by prioritizing the active session if both exist (though unlikely in practice).
2.  **Enhance `_aggregateEvents`**:
    -   Update the summary logic to check for `sourcePayload.topic` or `sourcePayload.title` *before* falling back to the cached `sessionTitles` map. This will provide immediate title resolution for `plan_management` events even if the cache is stale.

## Verification Plan

### Automated Tests
- I will create a temporary scratch script `/tmp/test_title_lookup.ts` that mocks the filesystem structure with both active and archived sessions and verifies that `SessionActionLog` can resolve titles from both.
- Run the script using `npx ts-node` or similar if available, or just perform a meticulous dry-run analysis.

### Manual Verification
- The user can verify by completing a plan and checking if its name still appears correctly in the Live Feed logs for past events.
