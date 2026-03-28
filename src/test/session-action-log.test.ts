import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SessionActionLog } from '../services/SessionActionLog';
import { KanbanDatabase } from '../services/KanbanDatabase';

async function waitFor(predicate: () => Promise<boolean> | boolean, timeoutMs: number = 5000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const done = await predicate();
        if (done) return;
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Timeout waiting for condition');
}

async function injectEvent(db: KanbanDatabase, event: { timestamp: string; type: string; payload: any; correlationId?: string }) {
    await db.appendActivityEvent({
        timestamp: event.timestamp,
        eventType: event.type,
        payload: JSON.stringify(event.payload),
        correlationId: event.correlationId,
        sessionId: event.payload?.sessionId || undefined
    });
}

async function run() {
    const root = path.join(os.tmpdir(), `switchboard-session-log-${Date.now()}`);
    fs.mkdirSync(root, { recursive: true });

    const db = KanbanDatabase.forWorkspace(root);
    const dbReady = await db.ensureReady();

    const log = new SessionActionLog(root);
    const activityPath = path.join(root, '.switchboard', 'sessions', 'activity.jsonl');

    // Test 1: logEvent shape
    await log.logEvent('workflow_event', { action: 'start_workflow', workflow: 'handoff' });
    await waitFor(async () => {
        if (dbReady) {
            const result = await db.getRecentActivity(10);
            return result.events.length > 0;
        }
        return fs.existsSync(activityPath) && (await fs.promises.readFile(activityPath, 'utf8')).trim().length > 0;
    });
    if (dbReady) {
        const result = await db.getRecentActivity(10);
        const row = result.events[0];
        assert.strictEqual(row.event_type, 'workflow_event');
        assert.ok(typeof row.timestamp === 'string');
        const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
        assert.strictEqual(payload.workflow, 'handoff');
    } else {
        const firstRows = (await fs.promises.readFile(activityPath, 'utf8'))
            .trim().split('\n').map(line => JSON.parse(line));
        assert.strictEqual(firstRows[0].type, 'workflow_event');
        assert.ok(typeof firstRows[0].timestamp === 'string');
        assert.strictEqual(firstRows[0].payload.workflow, 'handoff');
    }

    // Test 2: sensitive redaction
    await log.logEvent('workflow_event', {
        token: 'abc123',
        password: 'secret',
        nested: { apiKey: 'xyz', ok: 'yes' }
    });
    await waitFor(async () => {
        if (dbReady) {
            const result = await db.getRecentActivity(10);
            return result.events.length >= 2;
        }
        const rows = (await fs.promises.readFile(activityPath, 'utf8')).trim().split('\n');
        return rows.length >= 2;
    });
    if (dbReady) {
        const result = await db.getRecentActivity(10);
        const redactionRow = result.events.find((r: any) => {
            try {
                const p = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload;
                return p.token === '[REDACTED]';
            } catch { return false; }
        });
        assert.ok(redactionRow, 'Expected redacted event in DB');
        const payload = typeof redactionRow.payload === 'string' ? JSON.parse(redactionRow.payload) : redactionRow.payload;
        assert.strictEqual(payload.token, '[REDACTED]');
        assert.strictEqual(payload.password, '[REDACTED]');
        assert.strictEqual(payload.nested.apiKey, '[REDACTED]');
        assert.strictEqual(payload.nested.ok, 'yes');
    } else {
        const rows = (await fs.promises.readFile(activityPath, 'utf8'))
            .trim().split('\n').map(line => JSON.parse(line));
        const redactionRow = rows[rows.length - 1];
        assert.strictEqual(redactionRow.payload.token, '[REDACTED]');
        assert.strictEqual(redactionRow.payload.password, '[REDACTED]');
        assert.strictEqual(redactionRow.payload.nested.apiKey, '[REDACTED]');
        assert.strictEqual(redactionRow.payload.nested.ok, 'yes');
    }

    // Test 3: end-to-end event delivery (verifies retry mechanism implicitly)
    await log.logEvent('workflow_event', { action: 'retry_check' });
    await waitFor(async () => {
        if (dbReady) {
            const result = await db.getRecentActivity(20);
            return result.events.some((r: any) => {
                const p = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload;
                return p.action === 'retry_check';
            });
        }
        const rows = (await fs.promises.readFile(activityPath, 'utf8')).trim().split('\n');
        return rows.some(line => line.includes('"retry_check"'));
    });

    // Test 4: plan_management summary/truncation behavior
    await log.logEvent('plan_management', {
        operation: 'update_plan',
        planFile: '.switchboard/plans/demo.md',
        content: 'line1\nline2\nline3',
        beforeContent: 'line1',
        afterContent: 'line1\nline2'
    });
    await waitFor(async () => {
        if (dbReady) {
            const result = await db.getRecentActivity(20);
            return result.events.some((r: any) => {
                const p = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload;
                return p.operation === 'update_plan';
            });
        }
        const rows = (await fs.promises.readFile(activityPath, 'utf8')).trim().split('\n');
        return rows.some(line => line.includes('"update_plan"'));
    });
    if (dbReady) {
        const result = await db.getRecentActivity(20);
        const planRow = result.events.find((r: any) => {
            const p = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload;
            return p.operation === 'update_plan';
        });
        assert.ok(planRow, 'Expected plan_management event');
        const payload = typeof planRow.payload === 'string' ? JSON.parse(planRow.payload) : planRow.payload;
        assert.strictEqual(payload.operation, 'update_plan');
        assert.strictEqual(payload.contentLineCount, 3);
        assert.strictEqual(payload.beforeLineCount, 1);
        assert.strictEqual(payload.afterLineCount, 2);
        assert.strictEqual(payload.content, undefined);
    } else {
        const rows = (await fs.promises.readFile(activityPath, 'utf8'))
            .trim().split('\n').map(line => JSON.parse(line));
        const planRow = rows[rows.length - 1];
        assert.strictEqual(planRow.type, 'plan_management');
        assert.strictEqual(planRow.payload.operation, 'update_plan');
        assert.strictEqual(planRow.payload.contentLineCount, 3);
        assert.strictEqual(planRow.payload.beforeLineCount, 1);
        assert.strictEqual(planRow.payload.afterLineCount, 2);
        assert.strictEqual(planRow.payload.content, undefined);
    }

    // Test 5: Lazy Loading Pagination
    for (let i = 0; i < 100; i++) {
        await log.logEvent('spam', { idx: i });
    }
    await waitFor(async () => {
        if (dbReady) {
            const result = await db.getRecentActivity(200);
            return result.events.length >= 104;
        }
        const rows = (await fs.promises.readFile(activityPath, 'utf8')).trim().split('\n');
        return rows.length >= 104;
    });

    const page1 = await log.getRecentActivity(50);
    assert.strictEqual(page1.events.length, 50);
    assert.ok(page1.hasMore);
    assert.ok(page1.nextCursor);
    assert.strictEqual(page1.events[0].type, 'summary');

    const page2 = await log.getRecentActivity(50, page1.nextCursor);
    assert.strictEqual(page2.events.length, 50);

    // Test 6: Aggregation into summary event with plan title mapping
    const summarySessionId = 'sess_summary_1';
    await log.createRunSheet(summarySessionId, { planName: 'Alpha Plan', events: [] });

    // Invalidate title cache TTL
    await new Promise(resolve => setTimeout(resolve, 5100));

    const baseTs = Date.now() + 10_000;
    const syntheticEvents = [
        { timestamp: new Date(baseTs).toISOString(), type: 'ui_action', payload: { action: 'triggerAgentAction', role: 'reviewer', sessionId: summarySessionId } },
        { timestamp: new Date(baseTs + 120).toISOString(), type: 'dispatch', payload: { event: 'dispatch_sent', role: 'reviewer', sessionId: summarySessionId } },
        { timestamp: new Date(baseTs + 240).toISOString(), type: 'sent', payload: { event: 'sent', role: 'reviewer', sessionId: summarySessionId } }
    ];
    if (dbReady) {
        for (const ev of syntheticEvents) {
            await injectEvent(db, ev);
        }
    } else {
        await fs.promises.appendFile(activityPath, `${syntheticEvents.map(row => JSON.stringify(row)).join('\n')}\n`, 'utf8');
    }
    const summaryPage = await log.getRecentActivity(200);
    const summaryEvent = summaryPage.events.find(event => event.type === 'summary' && event.payload?.sessionId === summarySessionId);
    assert.ok(summaryEvent, 'expected summary event for UI+dispatch+sent sequence');
    assert.strictEqual(summaryEvent?.payload?.planTitle, 'Alpha Plan');
    assert.ok(String(summaryEvent?.payload?.message || '').includes('SENT TO'), `expected SENT TO in message, got: ${summaryEvent?.payload?.message}`);

    // Test 6b: autoban dispatch events stay typed
    const autobanSessionId = 'sess_autoban_1';
    await log.createRunSheet(autobanSessionId, { planName: 'Autoban Plan', events: [] });
    await log.logEvent('autoban_dispatch', {
        sessionId: autobanSessionId,
        sourceColumn: 'PLAN REVIEWED',
        targetRole: 'coder',
        sessionIds: [autobanSessionId],
        batchSize: 1,
        message: 'Autoban moved 1 plan(s) from PLAN REVIEWED -> coder'
    });
    const autobanPage = await log.getRecentActivity(200);
    const autobanEvent = autobanPage.events.find(event => event.type === 'autoban_dispatch' && event.payload?.sessionId === autobanSessionId);
    assert.ok(autobanEvent, 'expected autoban_dispatch event to remain unaggregated for renderer-specific formatting');
    assert.strictEqual(autobanEvent?.payload?.targetRole, 'coder');

    // Test 7: Run Sheet Management
    await log.createRunSheet('sess_test_1', { topic: 'test', events: [] });
    let sheet = await log.getRunSheet('sess_test_1');
    assert.strictEqual(sheet.sessionId, 'sess_test_1');
    assert.strictEqual(sheet.topic, 'test');

    await log.updateRunSheet('sess_test_1', (s) => { s.topic = 'updated'; return s; });
    sheet = await log.getRunSheet('sess_test_1');
    assert.strictEqual(sheet.topic, 'updated');

    const sheets = await log.getRunSheets();
    assert.ok(sheets.some(s => s.sessionId === 'sess_test_1'));

    await log.deleteRunSheet('sess_test_1');
    sheet = await log.getRunSheet('sess_test_1');
    assert.strictEqual(sheet, null);

    // Test 8: DB cleanup replaces log rotation
    if (dbReady) {
        const futureTs = new Date(Date.now() + 999_999_999).toISOString();
        await db.cleanupActivityLog(futureTs);
        const afterCleanup = await db.getRecentActivity(10);
        assert.strictEqual(afterCleanup.events.length, 0, 'Expected all events cleaned up with future timestamp');
    }

    // Test Case 1 (Timing): Events 800ms apart should be aggregated; events >1000ms apart should not
    const timingSessionId = 'sess_timing_1';
    await log.createRunSheet(timingSessionId, { planName: 'Timing Test', events: [] });
    const timingBase = Date.now() + 50_000;
    const timingEvents = [
        { timestamp: new Date(timingBase).toISOString(), type: 'ui_action', payload: { action: 'triggerAgentAction', role: 'lead', sessionId: timingSessionId } },
        { timestamp: new Date(timingBase + 800).toISOString(), type: 'dispatch', payload: { event: 'dispatch_sent', role: 'lead', sessionId: timingSessionId } },
        { timestamp: new Date(timingBase + 5000).toISOString(), type: 'ui_action', payload: { action: 'triggerAgentAction', role: 'coder', sessionId: timingSessionId } },
        { timestamp: new Date(timingBase + 6200).toISOString(), type: 'dispatch', payload: { event: 'dispatch_sent', role: 'coder', sessionId: timingSessionId } },
    ];
    if (dbReady) {
        for (const ev of timingEvents) { await injectEvent(db, ev); }
    } else {
        await fs.promises.appendFile(activityPath, timingEvents.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');
    }
    const timingPage = await log.getRecentActivity(200);
    const timingEventsResult = timingPage.events.filter(e => e.payload?.sessionId === timingSessionId);
    const pairAEvents = timingEventsResult.filter(e => e.payload?.role === 'lead');
    assert.strictEqual(pairAEvents.length, 1, `Pair A (800ms) should collapse to 1 event, got ${pairAEvents.length}`);
    const pairBEvents = timingEventsResult.filter(e => e.payload?.role === 'coder');
    assert.strictEqual(pairBEvents.length, 2, `Pair B (1200ms) should stay as 2 events, got ${pairBEvents.length}`);

    // Test Case 2 (Semantic Merge): ui_action + dispatch within 500ms → only dispatch kept
    const mergeSessionId = 'sess_merge_1';
    await log.createRunSheet(mergeSessionId, { planName: 'Merge Test', events: [] });
    const mergeBase = Date.now() + 100_000;
    const mergeEvts = [
        { timestamp: new Date(mergeBase).toISOString(), type: 'ui_action', payload: { action: 'triggerAgentAction', role: 'jules', sessionId: mergeSessionId } },
        { timestamp: new Date(mergeBase + 300).toISOString(), type: 'dispatch', payload: { event: 'dispatch_sent', role: 'jules', sessionId: mergeSessionId } },
    ];
    if (dbReady) {
        for (const ev of mergeEvts) { await injectEvent(db, ev); }
    } else {
        await fs.promises.appendFile(activityPath, mergeEvts.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');
    }
    const mergePage = await log.getRecentActivity(200);
    const mergeEvents = mergePage.events.filter(e => e.payload?.sessionId === mergeSessionId);
    assert.strictEqual(mergeEvents.length, 1, `Semantic merge: ui_action + dispatch within 500ms should collapse to 1 event, got ${mergeEvents.length}`);
    assert.ok(String(mergeEvents[0]?.payload?.message || '').includes('SENT TO'), `Merged event should use dispatch message, got: ${mergeEvents[0]?.payload?.message}`);

    // Test Case 3 (Correlation ID): events >1000ms apart with same correlationId should still be merged
    const corrSessionId = 'sess_corr_1';
    await log.createRunSheet(corrSessionId, { planName: 'Correlation Test', events: [] });
    const corrBase = Date.now() + 200_000;
    const corrId = 'test-corr-id-abc123';
    const corrEvts = [
        { timestamp: new Date(corrBase).toISOString(), type: 'ui_action', correlationId: corrId, payload: { action: 'triggerAgentAction', role: 'reviewer', sessionId: corrSessionId } },
        { timestamp: new Date(corrBase + 1500).toISOString(), type: 'dispatch', correlationId: corrId, payload: { event: 'dispatch_sent', role: 'reviewer', sessionId: corrSessionId } },
    ];
    if (dbReady) {
        for (const ev of corrEvts) { await injectEvent(db, ev); }
    } else {
        await fs.promises.appendFile(activityPath, corrEvts.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');
    }
    const corrPage = await log.getRecentActivity(200);
    const corrEvents = corrPage.events.filter(e => e.payload?.sessionId === corrSessionId);
    assert.strictEqual(corrEvents.length, 1, `Correlation ID: events 1500ms apart with same correlationId should merge to 1 event, got ${corrEvents.length}`);

    // Test: 'received' event is suppressed in live feed
    const receivedSessionId = 'sess_received_suppress';
    await log.createRunSheet(receivedSessionId, { planName: 'Received Suppress Test', events: [] });
    const receivedBase = Date.now() + 300_000;
    if (dbReady) {
        await injectEvent(db, { timestamp: new Date(receivedBase).toISOString(), type: 'dispatch', payload: { event: 'received', role: 'coder', sessionId: receivedSessionId } });
    } else {
        await fs.promises.appendFile(activityPath,
            JSON.stringify({ timestamp: new Date(receivedBase).toISOString(), type: 'dispatch', payload: { event: 'received', role: 'coder', sessionId: receivedSessionId } }) + '\n', 'utf8');
    }
    const receivedPage = await log.getRecentActivity(200);
    const receivedEvents = receivedPage.events.filter(e => e.payload?.sessionId === receivedSessionId);
    assert.strictEqual(receivedEvents.length, 0, `'received' event should be suppressed from live feed, got ${receivedEvents.length}`);

    // Test: 'submit_result' event is visible as COMPLETED
    const submitSessionId = 'sess_submit_result';
    await log.createRunSheet(submitSessionId, { planName: 'Submit Result Test', events: [] });
    const submitBase = Date.now() + 400_000;
    if (dbReady) {
        await injectEvent(db, { timestamp: new Date(submitBase).toISOString(), type: 'dispatch', payload: { event: 'submit_result', role: 'lead', sessionId: submitSessionId } });
    } else {
        await fs.promises.appendFile(activityPath,
            JSON.stringify({ timestamp: new Date(submitBase).toISOString(), type: 'dispatch', payload: { event: 'submit_result', role: 'lead', sessionId: submitSessionId } }) + '\n', 'utf8');
    }
    const submitPage = await log.getRecentActivity(200);
    const submitEvents = submitPage.events.filter(e => e.payload?.sessionId === submitSessionId);
    assert.strictEqual(submitEvents.length, 1, `'submit_result' event should appear in live feed, got ${submitEvents.length}`);
    assert.ok(String(submitEvents[0]?.payload?.message || '').includes('COMPLETED'), `submit_result message should include 'COMPLETED', got: ${submitEvents[0]?.payload?.message}`);

    // Test 9a: concurrent updateRunSheet — must not corrupt JSON
    const raceSessionId = 'sess_race_1';
    await log.createRunSheet(raceSessionId, { topic: 'race_base', events: [] });
    await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
            log.updateRunSheet(raceSessionId, (s: any) => {
                if (!s.events) s.events = [];
                s.events.push({ seq: i });
                return s;
            })
        )
    );
    const raceSheet = await log.getRunSheet(raceSessionId);
    assert.ok(raceSheet !== null, 'Race sheet must not be corrupted to null');
    assert.strictEqual(raceSheet.events.length, 20, `Expected 20 events, got ${raceSheet.events.length}`);

    // Test 9b: stale-snapshot regression — merge updater must not lose events
    const ssId = 'sess_snapshot_1';
    await log.createRunSheet(ssId, { topic: 'ss', events: [] });
    await Promise.all([
        log.updateRunSheet(ssId, (s: any) => { s.events.push({ ev: 'first' }); return s; }),
        log.updateRunSheet(ssId, (current: any) => ({ ...current, completed: true }))
    ]);
    const ssSheet = await log.getRunSheet(ssId);
    assert.ok(ssSheet.completed === true, 'completed flag must survive merge');
    assert.ok(ssSheet.events.length >= 1, 'events must not be wiped by merge updater');

    // Test 10: Archived session titles lazy-loading and caching
    const testArchiveId = 'sess_archived_1';
    const archiveDir = path.join(root, '.switchboard', 'archive', 'sessions');
    fs.mkdirSync(archiveDir, { recursive: true });
    fs.writeFileSync(path.join(archiveDir, `${testArchiveId}.json`), JSON.stringify({
        sessionId: testArchiveId,
        topic: 'Archived Topic'
    }));

    await log.logEvent('workflow_event', { action: 'test_archive_read' });
    await waitFor(async () => {
        if (dbReady) {
            const result = await db.getRecentActivity(200);
            return result.events.some((r: any) => {
                const p = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload;
                return p.action === 'test_archive_read';
            });
        }
        const rows = (await fs.promises.readFile(activityPath, 'utf8')).trim().split('\n');
        return rows.some(line => line.includes('test_archive_read'));
    });

    // Expire the cache from previous tests so the 1st read actually reads from disk
    await new Promise(resolve => setTimeout(resolve, 5100));

    // 1st read should populate the archive cache
    await log.getRecentActivity(10);

    // Modify the file on disk. If it re-reads, the title would change.
    fs.writeFileSync(path.join(archiveDir, `${testArchiveId}.json`), JSON.stringify({
        sessionId: testArchiveId,
        topic: 'MODIFIED TOPIC'
    }));

    // Expire the 5-second TTL for active sessions so it re-runs _readSessionTitleMap
    await new Promise(resolve => setTimeout(resolve, 5100));

    // Simulate a newly archived session being added
    const testArchiveId2 = 'sess_archived_2';
    fs.writeFileSync(path.join(archiveDir, `${testArchiveId2}.json`), JSON.stringify({
        sessionId: testArchiveId2,
        topic: 'Newly Archived Topic'
    }));

    // Inject synthetic events to force title resolution for these archived sessions
    if (dbReady) {
        await injectEvent(db, { timestamp: new Date(Date.now() + 1000).toISOString(), type: 'workflow_event', payload: { action: 'test_read_1', sessionId: testArchiveId } });
        await injectEvent(db, { timestamp: new Date(Date.now() + 2000).toISOString(), type: 'workflow_event', payload: { action: 'test_read_2', sessionId: testArchiveId2 } });
    } else {
        await fs.promises.appendFile(activityPath, [
            JSON.stringify({ timestamp: new Date(Date.now() + 1000).toISOString(), type: 'workflow_event', payload: { action: 'test_read_1', sessionId: testArchiveId } }),
            JSON.stringify({ timestamp: new Date(Date.now() + 2000).toISOString(), type: 'workflow_event', payload: { action: 'test_read_2', sessionId: testArchiveId2 } })
        ].join('\n') + '\n', 'utf8');
    }

    // 2nd read
    const recent = await log.getRecentActivity(50);
    const ev1 = recent.events.find(e => e.payload?.sessionId === testArchiveId);
    const ev2 = recent.events.find(e => e.payload?.sessionId === testArchiveId2);

    assert.ok(ev1, 'Expected to find event 1');
    assert.strictEqual(ev1?.payload?.planTitle, 'Archived Topic', 'Cache must retain the original topic and not re-read the modified file from disk');
    
    assert.ok(ev2, 'Expected to find event 2');
    assert.strictEqual(ev2?.payload?.planTitle, 'Newly Archived Topic', 'Must discover new archive files without re-reading old ones');

    // Cleanup
    if (fs.existsSync(root)) {
        fs.rmSync(root, { recursive: true, force: true });
    }
    // eslint-disable-next-line no-console
    console.log('session-action-log tests passed');
}

run().catch(error => {
    // eslint-disable-next-line no-console
    console.error('session-action-log tests failed:', error);
    process.exit(1);
});
