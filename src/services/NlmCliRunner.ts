import { execFile } from 'child_process';

// --- Error Classes ---

export class NlmAuthError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'NlmAuthError';
    }
}

export class NlmCliError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'NlmCliError';
    }
}

// --- Types ---

export interface NlmNotebook {
    id: string;
    title: string;
    [key: string]: unknown;
}

export interface NlmQueryResult {
    answer: string;
    [key: string]: unknown;
}

// --- Auth-error detection ---

const AUTH_KEYWORDS = /auth|login|cookie|unauthorized/i;

function checkAuthError(stderr: string): void {
    if (AUTH_KEYWORDS.test(stderr)) {
        throw new NlmAuthError(stderr.trim());
    }
}

// --- Helpers ---

function runNlm(args: string[]): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        execFile('nlm', args, { windowsHide: true, timeout: 120_000 }, (err, stdout, stderr) => {
            try {
                if (stderr) {
                    checkAuthError(stderr);
                }
                if (err) {
                    reject(new NlmCliError(stderr?.trim() || err.message));
                    return;
                }
                resolve({ stdout, stderr });
            } catch (e) {
                reject(e);
            }
        });
    });
}

function parseJson<T>(raw: string): T {
    try {
        return JSON.parse(raw);
    } catch {
        throw new NlmCliError(`Failed to parse nlm JSON output: ${raw.slice(0, 200)}`);
    }
}

// --- Public API ---

export async function listNotebooks(): Promise<NlmNotebook[]> {
    const { stdout } = await runNlm(['notebook', 'list', '--json']);
    return parseJson<NlmNotebook[]>(stdout);
}

export async function createNotebook(title: string): Promise<string> {
    const { stdout } = await runNlm(['notebook', 'create', title, '--json']);
    const result = parseJson<{ id?: string; notebook_id?: string }>(stdout);
    return result.id || result.notebook_id || stdout.trim();
}

export async function uploadSource(notebookId: string, filePath: string): Promise<string> {
    const { stdout } = await runNlm(['source', 'add', notebookId, '--file', filePath, '--wait', '--json']);
    const result = parseJson<{ id?: string; source_id?: string }>(stdout);
    return result.id || result.source_id || stdout.trim();
}

export async function queryNotebook(notebookId: string, question: string): Promise<NlmQueryResult> {
    const { stdout } = await runNlm(['notebook', 'query', notebookId, question, '--json']);
    const result = parseJson<NlmQueryResult>(stdout);
    return result;
}

export async function configureChat(notebookId: string, goal: string, prompt?: string): Promise<void> {
    const args = ['chat', 'configure', notebookId, '--goal', goal];
    if (prompt) { args.push('--prompt', prompt); }
    await runNlm(args);
}

export async function addDriveSource(notebookId: string, driveId: string): Promise<string> {
    const { stdout } = await runNlm(['source', 'add', notebookId, '--drive', driveId, '--json']);
    const result = parseJson<{ id?: string; source_id?: string }>(stdout);
    return result.id || result.source_id || stdout.trim();
}

export async function syncSources(notebookId: string): Promise<void> {
    await runNlm(['source', 'sync', notebookId, '--confirm']);
}
