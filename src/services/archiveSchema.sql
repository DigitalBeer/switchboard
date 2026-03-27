-- DuckDB Archive Schema v1
-- Stores completed/archived plans for cross-machine historical research

CREATE TABLE IF NOT EXISTS plans (
    plan_id VARCHAR PRIMARY KEY,
    session_id VARCHAR NOT NULL,
    topic VARCHAR,
    plan_file VARCHAR,
    kanban_column VARCHAR,
    status VARCHAR,
    complexity VARCHAR,
    workspace_id VARCHAR NOT NULL,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    last_action VARCHAR,
    source_type VARCHAR,
    tags VARCHAR,
    archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    days_to_completion INTEGER,
    revision_count INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_plans_workspace ON plans(workspace_id);
CREATE INDEX IF NOT EXISTS idx_plans_column ON plans(kanban_column);
CREATE INDEX IF NOT EXISTS idx_plans_complexity ON plans(complexity);
CREATE INDEX IF NOT EXISTS idx_plans_archived_at ON plans(archived_at);

CREATE TABLE IF NOT EXISTS archive_metadata (
    key VARCHAR PRIMARY KEY,
    value VARCHAR,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO archive_metadata (key, value)
VALUES ('schema_version', '1')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP;
