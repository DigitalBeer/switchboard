import { spawn, ChildProcess } from 'child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export type NotebookLmStatus = 'idle' | 'connecting' | 'bundling' | 'uploading' | 'querying' | 'complete' | 'error';

export interface NotebookLmStatusEvent {
    status: NotebookLmStatus;
    message?: string;
    error?: string;
}

export class NotebookLmService {
    private _process: ChildProcess | null = null;
    private _client: Client | null = null;
    private _transport: StdioClientTransport | null = null;
    private _initialized = false;
    private _onStatus: ((event: NotebookLmStatusEvent) => void) | undefined;

    constructor(onStatus?: (event: NotebookLmStatusEvent) => void) {
        this._onStatus = onStatus;
    }

    private _emit(status: NotebookLmStatus, message?: string, error?: string): void {
        this._onStatus?.({ status, message, error });
    }

    async checkUvxAvailable(): Promise<boolean> {
        return new Promise((resolve) => {
            const proc = spawn('uvx', ['--version'], { windowsHide: true, shell: true });
            proc.on('error', () => resolve(false));
            proc.on('close', (code) => resolve(code === 0));
        });
    }

    async initialize(): Promise<void> {
        if (this._initialized && this._client) { return; }

        this._emit('connecting', 'Starting NotebookLM MCP server...');

        const uvxAvailable = await this.checkUvxAvailable();
        if (!uvxAvailable) {
            this._emit('error', undefined, 'uvx not found. Install uv first: https://docs.astral.sh/uv/');
            throw new Error('uvx not found. Please install uv (https://docs.astral.sh/uv/) and ensure uvx is on your PATH.');
        }

        this._transport = new StdioClientTransport({
            command: 'uvx',
            args: ['--from', 'notebooklm-mcp-cli', 'notebooklm-mcp'],
        });

        this._client = new Client(
            { name: 'switchboard-notebooklm', version: '1.0.0' },
            { capabilities: {} }
        );

        try {
            await this._client.connect(this._transport);
            this._initialized = true;
            this._emit('idle', 'NotebookLM MCP server connected.');
        } catch (err: any) {
            this._emit('error', undefined, `Failed to connect to NotebookLM MCP server: ${err.message}`);
            throw err;
        }
    }

    async createAndQueryNotebook(contextFilePath: string, query: string): Promise<string> {
        if (!this._client || !this._initialized) {
            throw new Error('NotebookLmService not initialized. Call initialize() first.');
        }

        // Step 1: Create notebook
        this._emit('uploading', 'Creating notebook...');
        const createResult = await this._client.callTool({
            name: 'Notesbook',
            arguments: { title: 'Switchboard Session' },
        });
        const notebookId = this._extractText(createResult);
        if (!notebookId) {
            throw new Error('Failed to create notebook: no notebook_id returned.');
        }

        // Step 2: Upload source
        this._emit('uploading', 'Uploading workspace context...');
        await this._client.callTool({
            name: 'upload_source',
            arguments: { notebook_id: notebookId, file_path: contextFilePath },
        });

        // Step 3: Query
        this._emit('querying', 'Generating implementation spec...');
        const queryResult = await this._client.callTool({
            name: 'query_notebook',
            arguments: { notebook_id: notebookId, query },
        });

        const spec = this._extractText(queryResult);
        if (!spec) {
            throw new Error('NotebookLM returned an empty response.');
        }

        this._emit('complete', 'Spec generated successfully.');
        return spec;
    }

    private _extractText(result: any): string {
        // MCP tool results come back as { content: [{ type: 'text', text: '...' }] }
        if (result?.content && Array.isArray(result.content)) {
            return result.content
                .filter((c: any) => c.type === 'text')
                .map((c: any) => c.text)
                .join('');
        }
        if (typeof result === 'string') { return result; }
        return JSON.stringify(result);
    }

    async dispose(): Promise<void> {
        try {
            if (this._client) {
                await this._client.close();
            }
        } catch { /* ignore */ }
        this._client = null;
        this._transport = null;
        this._initialized = false;
    }
}
