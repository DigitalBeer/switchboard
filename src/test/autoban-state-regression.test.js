'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
    buildAutobanBroadcastState,
    normalizeAutobanConfigState
} = require(path.join(process.cwd(), 'out', 'services', 'autobanState.js'));

async function run() {
    const baseState = {
        enabled: true,
        batchSize: 3,
        complexityFilter: 'all',
        routingMode: 'dynamic',
        maxSendsPerTerminal: 7,
        globalSessionCap: 50,
        sessionSendCount: 9,
        sendCounts: { Reviewer: 4 },
        terminalPools: { reviewer: ['Reviewer', 'Reviewer Backup'] },
        managedTerminalPools: { reviewer: ['Reviewer Backup'] },
        poolCursor: { reviewer: 1 },
        rules: {
            CREATED: { enabled: true, intervalMinutes: 10 },
            'LEAD CODED': { enabled: true, intervalMinutes: 15 },
            'CODER CODED': { enabled: true, intervalMinutes: 15 }
        }
    };

    const broadcast = buildAutobanBroadcastState(baseState, new Map([
        ['CREATED', 1000],
        ['LEAD CODED', 2000],
        ['CODER CODED', 3000]
    ]).entries());

    assert.strictEqual(broadcast.enabled, true, 'enabled flag should be preserved');
    assert.strictEqual(broadcast.batchSize, 3, 'batch size should be preserved');
    assert.strictEqual(broadcast.complexityFilter, 'all', 'complexity filter should be preserved');
    assert.strictEqual(broadcast.routingMode, 'dynamic', 'routing mode should be preserved');
    assert.strictEqual(broadcast.maxSendsPerTerminal, 7, 'per-terminal send caps should be preserved');
    assert.strictEqual(broadcast.globalSessionCap, 50, 'global session cap should be preserved');
    assert.strictEqual(broadcast.sessionSendCount, 9, 'session send count should be preserved');
    assert.deepStrictEqual(broadcast.sendCounts, { Reviewer: 4 }, 'send counters should be preserved');
    assert.deepStrictEqual(broadcast.terminalPools, { reviewer: ['Reviewer', 'Reviewer Backup'] }, 'terminal pools should be preserved');
    assert.deepStrictEqual(broadcast.managedTerminalPools, { reviewer: ['Reviewer Backup'] }, 'managed pool membership should be preserved');
    assert.deepStrictEqual(broadcast.poolCursor, { reviewer: 1 }, 'pool cursor should be preserved');
    assert.deepStrictEqual(
        broadcast.lastTickAt,
        { CREATED: 1000, 'LEAD CODED': 2000, 'CODER CODED': 3000 },
        'lastTickAt should be merged into broadcast state'
    );

    const emptyBroadcast = buildAutobanBroadcastState(baseState, []);
    assert.deepStrictEqual(emptyBroadcast.lastTickAt, {}, 'lastTickAt should be present even when no tick timestamps are tracked yet');

    const normalizedLegacy = normalizeAutobanConfigState({
        enabled: true,
        batchSize: 0,
        rules: {
            CREATED: { enabled: false, intervalMinutes: 5 }
        }
    });
    assert.strictEqual(normalizedLegacy.batchSize, 3, 'legacy states should fall back to the default batch size when persisted data is invalid');
    assert.strictEqual(normalizedLegacy.complexityFilter, 'all', 'legacy states should default complexity filtering to all');
    assert.strictEqual(normalizedLegacy.routingMode, 'dynamic', 'legacy states should default routing mode to dynamic');
    assert.strictEqual(normalizedLegacy.maxSendsPerTerminal, 10, 'legacy states should default per-terminal autoban caps to 10');
    assert.strictEqual(normalizedLegacy.globalSessionCap, 200, 'legacy states should default the global autoban session cap to 200');
    assert.strictEqual(normalizedLegacy.sessionSendCount, 0, 'legacy states should default the session send count to 0');
    assert.deepStrictEqual(normalizedLegacy.sendCounts, {}, 'legacy states should default send counters to an empty record');
    assert.deepStrictEqual(normalizedLegacy.terminalPools, {}, 'legacy states should default terminal pools to an empty record');
    assert.deepStrictEqual(normalizedLegacy.managedTerminalPools, {}, 'legacy states should default managed pools to an empty record');
    assert.deepStrictEqual(normalizedLegacy.poolCursor, {}, 'legacy states should default pool cursors to an empty record');
    assert.deepStrictEqual(
        normalizedLegacy.rules['PLAN REVIEWED'],
        { enabled: true, intervalMinutes: 20 },
        'legacy states should restore missing default column rules'
    );
    assert.deepStrictEqual(
        normalizedLegacy.rules['LEAD CODED'],
        { enabled: true, intervalMinutes: 15 },
        'legacy states should restore the lead coded autoban rule'
    );
    assert.deepStrictEqual(
        normalizedLegacy.rules['CODER CODED'],
        { enabled: true, intervalMinutes: 15 },
        'legacy states should restore the coder coded autoban rule'
    );

    const normalizedLegacyCodedRule = normalizeAutobanConfigState({
        rules: {
            CODED: { enabled: false, intervalMinutes: 9 }
        }
    });
    assert.deepStrictEqual(
        normalizedLegacyCodedRule.rules['LEAD CODED'],
        { enabled: false, intervalMinutes: 9 },
        'legacy CODED autoban rules should be remapped onto LEAD CODED'
    );
    assert.deepStrictEqual(
        normalizedLegacyCodedRule.rules['CODER CODED'],
        { enabled: false, intervalMinutes: 9 },
        'legacy CODED autoban rules should be remapped onto CODER CODED'
    );

    const normalizedNewConfig = normalizeAutobanConfigState({
        maxSendsPerTerminal: 999,
        globalSessionCap: 0,
        sendCounts: { Reviewer: 2.9, '': 4 },
        terminalPools: { reviewer: ['Reviewer', 'Reviewer Backup', 'Reviewer', '', 'Three', 'Four', 'Five', 'Six'] },
        managedTerminalPools: { reviewer: ['Reviewer Backup', ''] },
        poolCursor: { reviewer: 2.4 }
    });
    assert.strictEqual(normalizedNewConfig.maxSendsPerTerminal, 100, 'per-terminal caps should clamp to the supported UI range');
    assert.strictEqual(normalizedNewConfig.globalSessionCap, 200, 'invalid global caps should fall back to the default safety cap');
    assert.deepStrictEqual(normalizedNewConfig.sendCounts, { Reviewer: 2 }, 'send counts should be normalized to non-negative integers');
    assert.deepStrictEqual(
        normalizedNewConfig.terminalPools,
        { reviewer: ['Reviewer', 'Reviewer Backup', 'Three', 'Four', 'Five'] },
        'terminal pools should be deduped, trimmed, and capped at five terminals'
    );
    assert.deepStrictEqual(
        normalizedNewConfig.managedTerminalPools,
        { reviewer: ['Reviewer Backup'] },
        'managed pools should be normalized the same way as configured pools'
    );
    assert.deepStrictEqual(normalizedNewConfig.poolCursor, { reviewer: 2 }, 'pool cursors should normalize to integer counters');

    const providerSource = fs.readFileSync(path.join(process.cwd(), 'src', 'services', 'TaskViewerProvider.ts'), 'utf8');
    const implementationSource = fs.readFileSync(path.join(process.cwd(), 'src', 'webview', 'implementation.html'), 'utf8');

    assert.ok(
        providerSource.includes('_selectAutobanTerminal(') &&
        providerSource.includes('updateAutobanMaxSends') &&
        providerSource.includes('addAutobanTerminal') &&
        providerSource.includes('resetAutobanPools'),
        'TaskViewerProvider should keep the pooled-autoban selection helper and new pool-management message handlers'
    );
    assert.ok(
        providerSource.includes('targetTerminalOverride?: string') &&
        providerSource.includes('selection.terminalName'),
        'TaskViewerProvider should preserve the terminal-override dispatch seam for autoban pools'
    );
    assert.ok(
        implementationSource.includes('MAX SENDS / TERMINAL') &&
        implementationSource.includes('TERMINAL POOLS') &&
        implementationSource.includes('CLEAR & RESET') &&
        implementationSource.includes("type: 'addAutobanTerminal'"),
        'implementation.html should render the send-cap control and terminal-pool management actions'
    );

    console.log('autoban state regression test passed');
}

run().catch((error) => {
    console.error('autoban state regression test failed:', error);
    process.exit(1);
});
