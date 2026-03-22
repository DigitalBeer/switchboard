const assert = require('assert');
const { parseCustomAgents, buildKanbanColumns } = require('../services/agentConfig');

describe('agentConfig — dragDropMode', () => {
    describe('parseCustomAgents()', () => {
        const baseAgent = {
            id: 'test_agent',
            name: 'Test Agent',
            startupCommand: 'test-cli run',
            includeInKanban: true,
            kanbanOrder: 400
        };

        it('returns dragDropMode "cli" when field is missing', () => {
            const agents = parseCustomAgents([{ ...baseAgent }]);
            assert.strictEqual(agents.length, 1);
            assert.strictEqual(agents[0].dragDropMode, 'cli');
        });

        it('returns dragDropMode "prompt" when explicitly set', () => {
            const agents = parseCustomAgents([{ ...baseAgent, dragDropMode: 'prompt' }]);
            assert.strictEqual(agents.length, 1);
            assert.strictEqual(agents[0].dragDropMode, 'prompt');
        });

        it('returns dragDropMode "cli" for invalid values', () => {
            const agents = parseCustomAgents([{ ...baseAgent, dragDropMode: 'banana' }]);
            assert.strictEqual(agents.length, 1);
            assert.strictEqual(agents[0].dragDropMode, 'cli');
        });

        it('returns dragDropMode "cli" when value is null', () => {
            const agents = parseCustomAgents([{ ...baseAgent, dragDropMode: null }]);
            assert.strictEqual(agents.length, 1);
            assert.strictEqual(agents[0].dragDropMode, 'cli');
        });

        it('returns dragDropMode "cli" when value is undefined', () => {
            const agents = parseCustomAgents([{ ...baseAgent, dragDropMode: undefined }]);
            assert.strictEqual(agents.length, 1);
            assert.strictEqual(agents[0].dragDropMode, 'cli');
        });
    });

    describe('buildKanbanColumns()', () => {
        it('sets dragDropMode "cli" on all default columns', () => {
            const columns = buildKanbanColumns([]);
            for (const col of columns) {
                assert.strictEqual(col.dragDropMode, 'cli', `Default column "${col.id}" should have dragDropMode "cli"`);
            }
        });

        it('propagates dragDropMode from custom agent', () => {
            const agents = parseCustomAgents([{
                id: 'prompt_agent',
                name: 'Prompt Agent',
                startupCommand: 'prompt-cli run',
                includeInKanban: true,
                kanbanOrder: 400,
                dragDropMode: 'prompt'
            }]);
            const columns = buildKanbanColumns(agents);
            const customCol = columns.find(c => c.kind === 'custom');
            assert.ok(customCol, 'Custom column should exist');
            assert.strictEqual(customCol.dragDropMode, 'prompt');
        });

        it('propagates dragDropMode "cli" from custom agent when not specified', () => {
            const agents = parseCustomAgents([{
                id: 'cli_agent',
                name: 'CLI Agent',
                startupCommand: 'cli-tool run',
                includeInKanban: true,
                kanbanOrder: 400
            }]);
            const columns = buildKanbanColumns(agents);
            const customCol = columns.find(c => c.kind === 'custom');
            assert.ok(customCol, 'Custom column should exist');
            assert.strictEqual(customCol.dragDropMode, 'cli');
        });
    });
});
