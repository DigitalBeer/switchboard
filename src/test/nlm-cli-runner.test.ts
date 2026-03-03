import * as assert from 'assert';
import * as cp from 'child_process';
import * as NlmCli from '../services/NlmCliRunner';
import { TaskViewerProvider } from '../services/TaskViewerProvider';

describe('NlmCliRunner & TaskViewerProvider NotebookLM Logic', () => {
    let originalExecFile: any;

    before(() => {
        originalExecFile = cp.execFile;
    });

    afterEach(() => {
        (cp as any).execFile = originalExecFile;
    });

    it('listNotebooks correctly parses JSON output', async () => {
        (cp as any).execFile = (cmd: string, args: string[], options: any, cb: any) => {
            cb(null, '[{"id":"123","title":"Test NB"}]', '');
        };
        const notebooks = await NlmCli.listNotebooks();
        assert.deepStrictEqual(notebooks, [{ id: '123', title: 'Test NB' }]);
    });

    it('detects Auth Error based on stderr keywords', async () => {
        (cp as any).execFile = (cmd: string, args: string[], options: any, cb: any) => {
            cb(new Error('Command failed'), '', 'Error: login required');
        };
        try {
            await NlmCli.listNotebooks();
            assert.fail('Should have thrown NlmAuthError');
        } catch (e: any) {
            assert.strictEqual(e.name, 'NlmAuthError');
            assert.strictEqual(e.message, 'Error: login required');
        }
    });

    it('queryNotebook safely constructs arguments', async () => {
        let capturedArgs: string[] = [];
        (cp as any).execFile = (cmd: string, args: string[], options: any, cb: any) => {
            capturedArgs = args;
            cb(null, '{"answer":"42"}', '');
        };
        const result = await NlmCli.queryNotebook('nb-123', 'What is life?');
        assert.deepStrictEqual(capturedArgs, ['notebook', 'query', 'nb-123', 'What is life?', '--json']);
        assert.strictEqual(result.answer, '42');
    });

    it('configureChat correctly passes --goal and handles --prompt arguments', async () => {
        let capturedArgs: string[] = [];
        (cp as any).execFile = (cmd: string, args: string[], options: any, cb: any) => {
            capturedArgs = args;
            cb(null, '{}', '');
        };

        await NlmCli.configureChat('nb-123', 'custom', 'Reply like a pirate');

        assert.deepStrictEqual(capturedArgs, [
            'chat', 'configure', 'nb-123', '--goal', 'custom', '--prompt', 'Reply like a pirate'
        ]);
    });

    it('configureChat omits --prompt when not provided', async () => {
        let capturedArgs: string[] = [];
        (cp as any).execFile = (cmd: string, args: string[], options: any, cb: any) => {
            capturedArgs = args;
            cb(null, '{}', '');
        };

        await NlmCli.configureChat('nb-123', 'research');

        assert.deepStrictEqual(capturedArgs, [
            'chat', 'configure', 'nb-123', '--goal', 'research'
        ]);
    });

    it('extractDocId correctly parses standard docs.google.com URLs', () => {
        // Access private static method for testing
        const extractDocId = (TaskViewerProvider as any)._extractDocId;

        const id1 = extractDocId('https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit');
        assert.strictEqual(id1, '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms');

        const id2 = extractDocId('https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0');
        assert.strictEqual(id2, '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms');

        const id3 = extractDocId('https://drive.google.com/open?id=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms');
        assert.strictEqual(id3, '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms');

        const id4 = extractDocId('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms');
        assert.strictEqual(id4, '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms');

        const id5 = extractDocId('invalid-url-or-short-id');
        assert.strictEqual(id5, null);
    });
});
