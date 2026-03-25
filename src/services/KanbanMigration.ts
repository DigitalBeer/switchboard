import { KanbanDatabase, KanbanPlanRecord } from './KanbanDatabase';

export type LegacyKanbanSnapshotRow = {
    planId: string;
    sessionId: string;
    topic: string;
    planFile: string;
    kanbanColumn: string;
    complexity: 'Unknown' | 'Low' | 'High';
    workspaceId: string;
    createdAt: string;
    updatedAt: string;
    lastAction: string;
    sourceType: 'local' | 'brain';
};

export class KanbanMigration {
    public static readonly SCHEMA_VERSION = 2;

    private static _normalizeLegacyCodedColumn(column: string, lastAction?: string): string {
        if (column !== 'CODED') {
            return column;
        }

        const workflow = String(lastAction || '').trim().toLowerCase();
        if (workflow === 'handoff' || workflow === 'coder' || workflow === 'jules') {
            return 'CODER CODED';
        }

        return 'LEAD CODED';
    }

    private static _toKanbanPlanRecords(snapshotRows: LegacyKanbanSnapshotRow[]): KanbanPlanRecord[] {
        return snapshotRows.map(row => ({
            ...row,
            kanbanColumn: KanbanMigration._normalizeLegacyCodedColumn(row.kanbanColumn, row.lastAction),
            status: 'active'
        }));
    }

    private static async _migrateLegacyCodedRows(db: KanbanDatabase, workspaceId: string): Promise<boolean> {
        const existingRows = await db.getBoard(workspaceId);
        for (const row of existingRows) {
            if (row.kanbanColumn !== 'CODED') {
                continue;
            }

            const remappedColumn = KanbanMigration._normalizeLegacyCodedColumn(row.kanbanColumn, row.lastAction);
            const updated = await db.updateColumn(row.sessionId, remappedColumn);
            if (!updated) {
                return false;
            }
        }

        return true;
    }

    public static async bootstrapIfNeeded(
        db: KanbanDatabase,
        workspaceId: string,
        snapshotRows: LegacyKanbanSnapshotRow[]
    ): Promise<boolean> {
        const ready = await db.ensureReady();
        if (!ready) return false;

        const currentVersion = await db.getMigrationVersion();
        const hasActivePlans = await db.hasActivePlans(workspaceId);

        if (!hasActivePlans) {
            // Guard: if the DB already has completed plans for this workspace,
            // the user finished all cards — don't re-bootstrap with derived columns.
            const completedPlans = await db.getCompletedPlans(workspaceId, 1);
            if (completedPlans.length === 0) {
                const rows = KanbanMigration._toKanbanPlanRecords(snapshotRows);
                const upserted = await db.upsertPlans(rows);
                if (!upserted) return false;
            }
        }

        if (currentVersion < KanbanMigration.SCHEMA_VERSION) {
            const migrated = await KanbanMigration._migrateLegacyCodedRows(db, workspaceId);
            if (!migrated) return false;
            return db.setMigrationVersion(KanbanMigration.SCHEMA_VERSION);
        }

        return true;
    }

    /**
     * Sync snapshot rows into the DB. New plans are inserted with their derived
     * column; existing plans only get metadata updates (topic, plan_file) —
     * kanban_column and status are NEVER overwritten for existing records.
     */
    public static async syncPlansMetadata(
        db: KanbanDatabase,
        workspaceId: string,
        snapshotRows: LegacyKanbanSnapshotRow[]
    ): Promise<boolean> {
        const ready = await db.ensureReady();
        if (!ready) return false;

        for (const row of snapshotRows) {
            const exists = await db.hasPlan(row.sessionId);
            if (!exists) {
                // New plan: insert with derived column (correct for first-time creation)
                const record: KanbanPlanRecord = {
                    ...row,
                    kanbanColumn: KanbanMigration._normalizeLegacyCodedColumn(row.kanbanColumn, row.lastAction),
                    status: 'active'
                };
                const inserted = await db.upsertPlans([record]);
                if (!inserted) return false;
            } else {
                // Existing plan: update metadata only, never touch kanban_column or status
                await db.updateTopic(row.sessionId, row.topic);
                await db.updatePlanFile(row.sessionId, row.planFile);
                // Always sync complexity from the freshly-parsed plan file so cards
                // that were first indexed before their Complexity Audit was filled in
                // pick up the correct value once the plan is improved.
                if (row.complexity === 'Low' || row.complexity === 'High') {
                    await db.updateComplexity(row.sessionId, row.complexity);
                }
            }
        }

        const currentVersion = await db.getMigrationVersion();
        if (currentVersion < KanbanMigration.SCHEMA_VERSION) {
            const migrated = await KanbanMigration._migrateLegacyCodedRows(db, workspaceId);
            if (!migrated) return false;
            return db.setMigrationVersion(KanbanMigration.SCHEMA_VERSION);
        }

        return true;
    }
}
