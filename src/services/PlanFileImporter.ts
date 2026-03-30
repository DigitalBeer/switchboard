import * as fs from 'fs';
import * as crypto from 'crypto';
import * as path from 'path';
import { KanbanDatabase, KanbanPlanRecord } from './KanbanDatabase';

/**
 * Scans `.switchboard/plans/*.md` and upserts records into the kanban DB.
 * Used by the "Reset Database" command to repopulate from plan files.
 */
export async function importPlanFiles(workspaceRoot: string): Promise<number> {
    const plansDir = path.join(workspaceRoot, '.switchboard', 'plans');
    if (!fs.existsSync(plansDir)) {
        return 0;
    }

    const files = (await fs.promises.readdir(plansDir))
        .filter(f => f.endsWith('.md'));

    if (files.length === 0) {
        return 0;
    }

    const db = KanbanDatabase.forWorkspace(workspaceRoot);
    const ready = await db.ensureReady();
    if (!ready) {
        return 0;
    }

    const workspaceId = await db.getWorkspaceId()
        || await db.getDominantWorkspaceId()
        || crypto.createHash('sha256').update(workspaceRoot).digest('hex').slice(0, 12);

    const now = new Date().toISOString();
    const records: KanbanPlanRecord[] = [];

    for (const file of files) {
        const filePath = path.join(plansDir, file);
        let content: string;
        try {
            content = await fs.promises.readFile(filePath, 'utf-8');
        } catch {
            continue;
        }

        const sessionId = 'import_' + crypto.createHash('sha256')
            .update(filePath)
            .digest('hex')
            .slice(0, 16);

        const topic = extractTopic(content, file);
        const complexity = extractComplexity(content);
        const tags = extractTags(content);
        const planFileNormalized = filePath.replace(/\\/g, '/');

        records.push({
            planId: sessionId,
            sessionId,
            topic,
            planFile: planFileNormalized,
            kanbanColumn: 'CREATED',
            status: 'active',
            complexity,
            tags,
            workspaceId,
            createdAt: now,
            updatedAt: now,
            lastAction: 'imported_from_plan_file',
            sourceType: 'local',
            brainSourcePath: '',
            mirrorPath: ''
        });
    }

    if (records.length === 0) {
        return 0;
    }

    const success = await db.upsertPlans(records);
    return success ? records.length : 0;
}

function extractTopic(content: string, filename: string): string {
    const h1Match = content.match(/^#\s+(.+)$/m);
    if (h1Match) {
        return h1Match[1].trim();
    }
    return filename.replace(/\.md$/i, '').replace(/[_-]/g, ' ');
}

function extractComplexity(content: string): 'Unknown' | 'Low' | 'High' {
    const metadataMatch = content.match(/## Metadata[\s\S]*?\*\*Complexity:\*\*\s*(Low|High)/i);
    if (metadataMatch) {
        const val = metadataMatch[1];
        if (val.toLowerCase() === 'low') return 'Low';
        if (val.toLowerCase() === 'high') return 'High';
    }
    return 'Unknown';
}

function extractTags(content: string): string {
    const tagsMatch = content.match(/## Metadata[\s\S]*?\*\*Tags:\*\*\s*(.+)/i);
    if (tagsMatch) {
        return tagsMatch[1].trim();
    }
    return '';
}
