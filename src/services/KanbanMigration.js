// This file is a hand-maintained JS mirror of KanbanMigration.ts — keep in sync.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KanbanMigration = void 0;
class KanbanMigration {
    static SCHEMA_VERSION = 2;
    static _normalizeLegacyCodedColumn(column, lastAction) {
        if (column !== 'CODED') {
            return column;
        }
        const workflow = String(lastAction || '').trim().toLowerCase();
        if (workflow === 'handoff' || workflow === 'coder' || workflow === 'jules') {
            return 'CODER CODED';
        }
        return 'LEAD CODED';
    }
    static _toKanbanPlanRecords(snapshotRows) {
        return snapshotRows.map(row => ({
            ...row,
            kanbanColumn: KanbanMigration._normalizeLegacyCodedColumn(row.kanbanColumn, row.lastAction),
            status: 'active'
        }));
    }
    static async _migrateLegacyCodedRows(db, workspaceId) {
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
    static async bootstrapIfNeeded(db, workspaceId, snapshotRows) {
        const ready = await db.ensureReady();
        if (!ready)
            return false;
        const currentVersion = await db.getMigrationVersion();
        const hasActivePlans = await db.hasActivePlans(workspaceId);
        if (!hasActivePlans) {
            // Guard: if the DB already has completed plans for this workspace,
            // the user finished all cards — don't re-bootstrap with derived columns.
            const completedPlans = await db.getCompletedPlans(workspaceId, 1);
            if (completedPlans.length === 0) {
                const rows = KanbanMigration._toKanbanPlanRecords(snapshotRows);
                const upserted = await db.upsertPlans(rows);
                if (!upserted)
                    return false;
            }
        }
        if (currentVersion < KanbanMigration.SCHEMA_VERSION) {
            const migrated = await KanbanMigration._migrateLegacyCodedRows(db, workspaceId);
            if (!migrated)
                return false;
            return db.setMigrationVersion(KanbanMigration.SCHEMA_VERSION);
        }
        return true;
    }
    /**
     * Sync snapshot rows into the DB. New plans are inserted with their derived
     * column; existing plans only get metadata updates (topic, plan_file) —
     * kanban_column and status are NEVER overwritten for existing records.
     */
    static async syncPlansMetadata(db, workspaceId, snapshotRows) {
        const ready = await db.ensureReady();
        if (!ready)
            return false;
        for (const row of snapshotRows) {
            const exists = await db.hasPlan(row.sessionId);
            if (!exists) {
                const record = {
                    ...row,
                    kanbanColumn: KanbanMigration._normalizeLegacyCodedColumn(row.kanbanColumn, row.lastAction),
                    status: 'active'
                };
                const inserted = await db.upsertPlans([record]);
                if (!inserted)
                    return false;
            }
            else {
                await db.updateTopic(row.sessionId, row.topic);
                await db.updatePlanFile(row.sessionId, row.planFile);
            }
        }
        const currentVersion = await db.getMigrationVersion();
        if (currentVersion < KanbanMigration.SCHEMA_VERSION) {
            const migrated = await KanbanMigration._migrateLegacyCodedRows(db, workspaceId);
            if (!migrated)
                return false;
            return db.setMigrationVersion(KanbanMigration.SCHEMA_VERSION);
        }
        return true;
    }
}
exports.KanbanMigration = KanbanMigration;