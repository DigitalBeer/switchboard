'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { KanbanDatabase } = require(path.join(process.cwd(), 'out', 'services', 'KanbanDatabase.js'));

async function run() {
    const ws = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sb-mtime-test-'));
    try {
        // First init — creates the DB
        const db = KanbanDatabase.forWorkspace(ws);
        const ready = await db.ensureReady();
        assert.strictEqual(ready, true, 'DB should initialize');

        // Write a plan so the DB has content
        const now = new Date().toISOString();
        await db.upsertPlans([{
            planId: 'mtime-test-plan',
            sessionId: 'mtime-test-sess',
            topic: 'Mtime Test',
            planFile: '.switchboard/plans/mtime-test.md',
            kanbanColumn: 'CREATED',
            status: 'active',
            complexity: 'Unknown',
            workspaceId: 'ws-mtime',
            createdAt: now,
            updatedAt: now,
            lastAction: 'created',
            sourceType: 'local',
            brainSourcePath: '',
            mirrorPath: ''
        }]);

        // Simulate external modification by touching the file with a future mtime
        const dbPath = db.dbPath;
        const futureTime = Date.now() + 60000; // 1 minute in the future
        await fs.promises.utimes(dbPath, futureTime / 1000, futureTime / 1000);

        // Invalidate and re-create — _initialize should detect mtime change
        await KanbanDatabase.invalidateWorkspace(ws);
        const db2 = KanbanDatabase.forWorkspace(ws);

        // Note: We can't directly assert the console.warn was called without mocking,
        // but we can verify the DB still loads correctly after external modification
        const ready2 = await db2.ensureReady();
        assert.strictEqual(ready2, true, 'DB should re-initialize after external modification');

        const plan = await db2.getPlanBySessionId('mtime-test-sess');
        assert.ok(plan, 'Plan should still exist after reload');
        assert.strictEqual(plan.topic, 'Mtime Test', 'Plan data should be intact');

        console.log('kanban-database mtime tests passed');
    } finally {
        await KanbanDatabase.invalidateWorkspace(ws);
        await fs.promises.rm(ws, { recursive: true, force: true });
    }
}

run().catch((error) => {
    console.error('kanban-database mtime tests failed:', error);
    process.exit(1);
});
