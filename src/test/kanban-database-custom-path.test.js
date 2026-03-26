'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { KanbanDatabase } = require(path.join(process.cwd(), 'out', 'services', 'KanbanDatabase.js'));

async function run() {
    // Test 1: Default path
    const ws1 = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sb-path-test-'));
    try {
        const db1 = KanbanDatabase.forWorkspace(ws1);
        assert.strictEqual(
            db1.dbPath,
            path.join(ws1, '.switchboard', 'kanban.db'),
            'Default dbPath should be .switchboard/kanban.db'
        );
        console.log('  ✓ Default path');
    } finally {
        await KanbanDatabase.invalidateWorkspace(ws1);
        await fs.promises.rm(ws1, { recursive: true, force: true });
    }

    // Test 2: Explicit custom path (absolute)
    const ws2 = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sb-path-test-'));
    const customAbs = path.join(os.tmpdir(), 'sb-custom-abs', 'kanban.db');
    // Ensure dir exists for the custom path
    await fs.promises.mkdir(path.dirname(customAbs), { recursive: true });
    try {
        const db2 = KanbanDatabase.forWorkspace(ws2, customAbs);
        assert.strictEqual(db2.dbPath, customAbs, 'Absolute custom path should be used as-is');
        console.log('  ✓ Absolute custom path');
    } finally {
        await KanbanDatabase.invalidateWorkspace(ws2);
        await fs.promises.rm(ws2, { recursive: true, force: true });
        await fs.promises.rm(path.dirname(customAbs), { recursive: true, force: true });
    }

    // Test 3: Explicit custom path (relative)
    const ws3 = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sb-path-test-'));
    try {
        const db3 = KanbanDatabase.forWorkspace(ws3, 'mydata/kanban.db');
        assert.strictEqual(
            db3.dbPath,
            path.join(ws3, 'mydata', 'kanban.db'),
            'Relative custom path should resolve against workspace root'
        );
        console.log('  ✓ Relative custom path');
    } finally {
        await KanbanDatabase.invalidateWorkspace(ws3);
        await fs.promises.rm(ws3, { recursive: true, force: true });
    }

    // Test 4: Tilde expansion
    const ws4 = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sb-path-test-'));
    try {
        const db4 = KanbanDatabase.forWorkspace(ws4, '~/sb-tilde-test/kanban.db');
        assert.strictEqual(
            db4.dbPath,
            path.join(os.homedir(), 'sb-tilde-test', 'kanban.db'),
            'Tilde should expand to home directory'
        );
        console.log('  ✓ Tilde expansion');
    } finally {
        await KanbanDatabase.invalidateWorkspace(ws4);
        await fs.promises.rm(ws4, { recursive: true, force: true });
    }

    // Test 5: Invalidation creates a new instance
    const ws5 = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sb-path-test-'));
    try {
        const db5a = KanbanDatabase.forWorkspace(ws5);
        await KanbanDatabase.invalidateWorkspace(ws5);
        const db5b = KanbanDatabase.forWorkspace(ws5);
        assert.notStrictEqual(db5a, db5b, 'Post-invalidation forWorkspace should return a new instance');
        console.log('  ✓ Invalidation creates new instance');
    } finally {
        await KanbanDatabase.invalidateWorkspace(ws5);
        await fs.promises.rm(ws5, { recursive: true, force: true });
    }

    console.log('kanban-database custom-path tests passed');
}

run().catch((error) => {
    console.error('kanban-database custom-path tests failed:', error);
    process.exit(1);
});
