import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export type ReviewPlanContext = {
    sessionId?: string;
    topic?: string;
    planFileAbsolute: string;
};

export type ReviewCommentRequest = {
    sessionId?: string;
    topic?: string;
    planFileAbsolute: string;
    selectedText: string;
    comment: string;
};

export type ReviewCommentResult = {
    ok: boolean;
    message: string;
    targetAgent?: string;
    preferredRole?: string;
};

/**
 * Provides a dedicated Review webview panel for contextual comments on plan markdown.
 */
export class ReviewProvider implements vscode.Disposable {
    private _panel?: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private _currentPlan?: ReviewPlanContext;
    private _lastSelection: { selectedText: string; selectionRect?: { top: number; left: number; width: number; height: number } } | undefined;

    constructor(private readonly _extensionUri: vscode.Uri) { }

    public dispose(): void {
        this._panel?.dispose();
        this._disposables.forEach(disposable => disposable.dispose());
        this._disposables = [];
    }

    public reveal(): void {
        if (this._panel) {
            this._panel.reveal(vscode.ViewColumn.One);
        }
    }

    public async open(plan: ReviewPlanContext): Promise<void> {
        this._currentPlan = plan;

        if (this._panel) {
            this._panel.reveal(vscode.ViewColumn.One);
            await this._renderCurrentPlan();
            return;
        }

        this._panel = vscode.window.createWebviewPanel(
            'switchboard-review',
            'Plan Review',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [this._extensionUri]
            }
        );

        this._panel.iconPath = vscode.Uri.joinPath(this._extensionUri, 'icon.svg');
        this._panel.webview.html = await this._getHtml(this._panel.webview);

        this._panel.webview.onDidReceiveMessage(
            async (msg) => this._handleMessage(msg),
            undefined,
            this._disposables
        );

        this._panel.onDidDispose(() => {
            this._panel = undefined;
            this._lastSelection = undefined;
        }, null, this._disposables);

        await this._renderCurrentPlan();
    }

    private async _handleMessage(msg: any): Promise<void> {
        if (!this._panel) return;

        switch (msg?.type) {
            case 'ready':
                await this._renderCurrentPlan();
                break;
            case 'selectionChanged': {
                if (typeof msg?.selectedText === 'string' && msg.selectedText.trim().length > 0) {
                    this._lastSelection = {
                        selectedText: msg.selectedText,
                        selectionRect: msg.selectionRect
                    };
                } else {
                    this._lastSelection = undefined;
                }
                break;
            }
            case 'submitComment': {
                try {
                    if (!this._currentPlan) {
                        throw new Error('No plan loaded in review panel.');
                    }

                    const selectedText = typeof msg?.selectedText === 'string'
                        ? msg.selectedText.trim()
                        : (this._lastSelection?.selectedText || '').trim();
                    const comment = typeof msg?.comment === 'string' ? msg.comment.trim() : '';

                    if (!selectedText) {
                        throw new Error('Please select text before submitting a comment.');
                    }
                    if (!comment) {
                        throw new Error('Please enter a comment before submitting.');
                    }

                    const request: ReviewCommentRequest = {
                        sessionId: this._currentPlan.sessionId,
                        topic: this._currentPlan.topic,
                        planFileAbsolute: this._currentPlan.planFileAbsolute,
                        selectedText,
                        comment
                    };

                    const result = await vscode.commands.executeCommand<ReviewCommentResult>(
                        'switchboard.sendReviewComment',
                        request
                    );

                    const normalizedResult: ReviewCommentResult = result && typeof result.ok === 'boolean'
                        ? result
                        : { ok: false, message: 'Review comment dispatch failed (no response).' };

                    this._panel.webview.postMessage({ type: 'commentResult', ...normalizedResult });
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    this._panel.webview.postMessage({ type: 'commentResult', ok: false, message });
                }
                break;
            }
        }
    }

    private async _renderCurrentPlan(): Promise<void> {
        if (!this._panel || !this._currentPlan) return;

        const markdownSource = await fs.promises.readFile(this._currentPlan.planFileAbsolute, 'utf8');
        const renderedHtml = await vscode.commands.executeCommand<string>('markdown.api.render', markdownSource);
        if (typeof renderedHtml !== 'string') {
            throw new Error('Markdown renderer returned no output.');
        }

        const title = this._currentPlan.topic?.trim() || path.basename(this._currentPlan.planFileAbsolute);
        this._panel.title = `Review: ${title}`;
        this._panel.webview.postMessage({
            type: 'renderPlan',
            topic: title,
            sessionId: this._currentPlan.sessionId,
            planFileAbsolute: this._currentPlan.planFileAbsolute,
            renderedHtml
        });
    }

    private async _getHtml(webview: vscode.Webview): Promise<string> {
        const paths = [
            vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview', 'review.html'),
            vscode.Uri.joinPath(this._extensionUri, 'webview', 'review.html'),
            vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'review.html')
        ];

        let htmlUri: vscode.Uri | undefined;
        for (const candidate of paths) {
            try {
                await vscode.workspace.fs.stat(candidate);
                htmlUri = candidate;
                break;
            } catch {
                // Continue to next candidate.
            }
        }

        if (!htmlUri) {
            return `<html><body style="padding:20px;font-family:sans-serif;">Review webview HTML not found.</body></html>`;
        }

        const contentBuffer = await vscode.workspace.fs.readFile(htmlUri);
        let content = Buffer.from(contentBuffer).toString('utf8');

        const nonce = crypto.randomBytes(16).toString('base64');
        const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' ${webview.cspSource}; style-src 'unsafe-inline' ${webview.cspSource}; img-src ${webview.cspSource} data:; font-src ${webview.cspSource};">`;
        content = content.replace('<head>', `<head>\n    ${csp}`);
        content = content.replace(/<script>/g, `<script nonce="${nonce}">`);

        return content;
    }
}
