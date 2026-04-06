# Chat Export to Archive Database

## Goal
Implement a user-triggered `/export` command that saves the current chat conversation to a temporary markdown file, uploads it to the DuckDB archival database via an MCP tool, then cleans up the temp file. This enables cross-project memory retrieval through future search capabilities.

## Metadata
**Tags:** backend, database
**Complexity:** Low

## Complexity Audit

**Manual Complexity Override:** Low

### Routine
- Create MCP tool `export_conversation` that accepts a file path and optional metadata
- Tool reads temp markdown file, inserts into DuckDB `conversations` table, deletes temp file
- Add second MCP tool `search_archive` for basic keyword search across archived conversations

### Complex / Risky
- None. Straightforward file I/O and SQL operations.

## Edge-Case & Dependency Audit

- **Race Conditions:** Minimal. Temp file deletion happens synchronously after successful DB insert. If delete fails, file remains in temp — acceptable degradation.
- **Security:** File path is passed directly from agent to MCP tool. No path traversal risk if tool validates path is within temp directory.
- **Side Effects:** Creates then deletes temporary files. DB writes are append-only.
- **Dependencies & Conflicts:** Depends on existing DuckDB infrastructure from `feature_plan_20260327_103635_archive_database.md`. No conflicts with other pending plans.

## Adversarial Synthesis

### Grumpy Critique
"Oh, brilliant. A manual export workflow in the age of automatic telemetry. Users have to *remember* to type `/export`? The conversation is sitting in memory anyway — why not just auto-archive everything and be done with it? Also, a single `conversations` table with a text blob is going to age like milk the moment someone wants to query 'what did we say about function X in March?' You'll end up full-text searching a gigabyte of markdown."

### Balanced Response
Grumpy's auto-archive suggestion is valid but explicitly out of scope — the user wants manual control over what gets persisted. The text-blob concern is **addressed**: we now have structured metadata columns (`conversation_date`, `topic`, `project`, `tags`) that enable efficient filtering **before** full-text search. Users can query "show me all conversations about 'database' in March 2026 tagged 'planning'" without scanning a gigabyte of markdown. The full content is still stored for detailed search, but structured metadata makes common queries fast.

## Proposed Changes

### Target File: `/Users/patrickvuleta/Documents/GitHub/switchboard/src/mcp-server/register-tools.js`

#### [CREATE] MCP Tool: `export_conversation`

**Context:** Add new MCP tool to export chat conversations to DuckDB archive. The existing MCP tool registration pattern is in `register-tools.js`.

**Logic:**
1. Register tool with schema: `file_path` (required string), `metadata` (optional object with date, topic, tags, project)
2. Validate `file_path` is within OS temp directory (security: prevent arbitrary file reads)
3. Read markdown file content
4. Extract title from first H1 (`# Title`) or use first 50 chars
5. Extract/use metadata:
   - `conversation_date`: use provided date or extract from content (e.g. first timestamp) or use today
   - `topic`: use provided topic or extract from title
   - `tags`: use provided tags array or empty array
   - `project`: use provided project or extract from workspace name
6. Generate UUID for conversation ID
7. Execute DuckDB INSERT with structured metadata columns
8. Delete temp file only after successful insert
9. Return `{success: true, conversationId: uuid}` or `{success: false, error: string}`

**Implementation:**

```javascript
// Add to register-tools.js after existing tool registrations

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      // ... existing tools ...
      {
        name: 'export_conversation',
        description: 'Export current chat conversation to archive database for future retrieval',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: 'Absolute path to temporary markdown file containing conversation'
            },
            metadata: {
              type: 'object',
              description: 'Optional metadata for better searchability',
              properties: {
                conversation_date: { type: 'string', description: 'Date of conversation (YYYY-MM-DD)' },
                topic: { type: 'string', description: 'Short topic/summary of conversation' },
                project: { type: 'string', description: 'Project name (e.g. switchboard)' },
                tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorization' }
              }
            }
          },
          required: ['file_path']
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  if (name === 'export_conversation') {
    const { file_path, metadata = {} } = args;
    
    // Security: validate path is in temp directory
    const tmpDir = os.tmpdir();
    const resolvedPath = path.resolve(file_path);
    if (!resolvedPath.startsWith(tmpDir)) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ success: false, error: 'File path must be in system temp directory' })
        }]
      };
    }
    
    // Check file exists and size
    if (!fs.existsSync(resolvedPath)) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ success: false, error: 'File not found' })
        }]
      };
    }
    
    const stats = fs.statSync(resolvedPath);
    if (stats.size === 0) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ success: false, error: 'File is empty' })
        }]
      };
    }
    
    if (stats.size > 10 * 1024 * 1024) { // 10MB
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ success: false, error: 'File too large (max 10MB)' })
        }]
      };
    }
    
    // Read content
    const content = fs.readFileSync(resolvedPath, 'utf8');
    
    // Extract title from first H1 or first 50 chars
    const h1Match = content.match(/^#\s+(.+)$/m);
    const title = h1Match ? h1Match[1].trim() : content.substring(0, 50).trim();
    
    // Generate UUID
    const conversationId = crypto.randomUUID();
    
    // Get archive path from config
    const config = vscode.workspace.getConfiguration('switchboard');
    const archivePath = config.get('archive.dbPath', '');
    
    if (!archivePath) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ success: false, error: 'Archive database not configured' })
        }]
      };
    }
    
    // Ensure schema exists
    const schemaPath = path.join(__dirname, '../services/archiveSchema.sql');
    if (fs.existsSync(schemaPath)) {
      const schema = fs.readFileSync(schemaPath, 'utf8');
      await execFileAsync('duckdb', [archivePath, '-c', schema]);
    }
    
    // Extract structured metadata
    const conversationDate = metadata.conversation_date || new Date().toISOString().split('T')[0];
    const topic = metadata.topic || title;
    const project = metadata.project || path.basename(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || 'unknown');
    const tags = metadata.tags || [];
    const tagsArray = tags.length > 0 ? `ARRAY[${tags.map(t => `'${t.replace(/'/g, "''")}' `).join(',')}]` : 'ARRAY[]::TEXT[]';
    const metadataJson = JSON.stringify(metadata).replace(/'/g, "''");
    
    // Insert into conversations table with structured metadata
    const sql = `INSERT INTO conversations (id, exported_at, conversation_date, topic, title, content, tags, project, metadata, file_path_original) VALUES ('${conversationId}', CURRENT_TIMESTAMP, '${conversationDate}', '${topic.replace(/'/g, "''")}', '${title.replace(/'/g, "''")}', '${content.replace(/'/g, "''")}', ${tagsArray}, '${project.replace(/'/g, "''")}', '${metadataJson}', '${resolvedPath.replace(/'/g, "''")}');`;
    
    try {
      await execFileAsync('duckdb', [archivePath, '-c', sql]);
      
      // Delete temp file after successful insert
      fs.unlinkSync(resolvedPath);
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ success: true, conversationId, title })
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ success: false, error: error.message })
        }]
      };
    }
  }
  
  // ... existing tool handlers ...
});
```

**Edge Cases Handled:**
- Path traversal attack: validates file is in temp directory
- Empty file: rejects with error
- File too large (>10MB): rejects with error
- DB insert fails: does NOT delete temp file, returns error
- Missing archive config: returns helpful error message

### Target File: `/Users/patrickvuleta/Documents/GitHub/switchboard/src/services/archiveSchema.sql`

#### [MODIFY] Archive Database Schema

**Context:** The existing `archiveSchema.sql` defines the `plans` table. We need to add a `conversations` table for chat exports.

**Logic:** Append the conversations table schema to the existing SQL file. Use `CREATE TABLE IF NOT EXISTS` for idempotency.

**Implementation:**

**APPEND to archiveSchema.sql:**
```sql
-- Conversations archive table (for /export command)
CREATE TABLE IF NOT EXISTS conversations (
    id VARCHAR PRIMARY KEY,
    exported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    conversation_date DATE,              -- Date of the conversation (user-provided or extracted)
    topic TEXT,                          -- Short topic/summary (user-provided or extracted from title)
    title TEXT NOT NULL,                 -- Extracted from first H1 or first 50 chars
    content TEXT NOT NULL,               -- Full markdown conversation
    tags TEXT[],                         -- Array of tags for categorization
    project TEXT,                        -- Project name (e.g. 'switchboard', 'my-app')
    metadata JSON,                       -- Additional freeform metadata
    file_path_original TEXT              -- Original temp file path (for debugging)
);

-- Full-text search index for conversations
INSTALL fts;
LOAD fts;

PRAGMA create_fts_index('conversations', 'id', 'title', 'content', 'topic');

-- Index for efficient filtering by date and project
CREATE INDEX IF NOT EXISTS idx_conversations_date ON conversations(conversation_date DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project);
```

**Edge Cases Handled:**
- `IF NOT EXISTS` prevents errors if schema already applied
- FTS extension installed/loaded before creating index
- `VARCHAR` used for UUID instead of native UUID type (better DuckDB compatibility)
- Structured columns (date, topic, tags, project) enable efficient filtering before FTS
- Indexes on date and project for fast queries like "show me all conversations from March about switchboard"

### Target File: `/Users/patrickvuleta/Documents/GitHub/switchboard/src/mcp-server/register-tools.js`

#### [CREATE] MCP Tool: `search_archive`

**Context:** Companion tool to search exported conversations. Uses DuckDB FTS (full-text search).

**Logic:**
1. Accept `query` (string) and optional `limit` (default 10)
2. Execute FTS query via `ArchiveManager.queryArchive` (reuses existing security checks)
3. Return array of `{id, title, exported_at, snippet}` objects

**Implementation:**

```javascript
// Add to tool list in register-tools.js
{
  name: 'search_archive',
  description: 'Search archived conversations by keyword',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query (keywords)'
      },
      limit: {
        type: 'number',
        description: 'Maximum results to return (default 10)',
        default: 10
      }
    },
    required: ['query']
  }
}

// Add to CallToolRequestSchema handler
if (name === 'search_archive') {
  const { query, limit = 10 } = args;
  
  const archiveManager = new ArchiveManager(workspaceRoot);
  
  if (!archiveManager.isConfigured) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ success: false, error: 'Archive not configured' })
      }]
    };
  }
  
  try {
    // Use DuckDB FTS to search conversations with structured metadata
    const sql = `SELECT id, title, topic, conversation_date, project, tags, exported_at, substring(content, 1, 200) as snippet FROM conversations WHERE fts_main_conversations.match_bm25(id, '${query.replace(/'/g, "''")}') IS NOT NULL ORDER BY conversation_date DESC, exported_at DESC`;
    
    const results = await archiveManager.queryArchive(sql, limit);
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ success: true, results })
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ success: false, error: error.message })
      }]
    };
  }
}
```

**Edge Cases Handled:**
- No matches: returns empty array (DuckDB behavior)
- Query syntax error: caught and returned as error message
- Archive not configured: returns helpful error

### Target File: `/Users/patrickvuleta/Documents/GitHub/switchboard/.agent/workflows/export.md` (Optional)

#### [CREATE] Workflow Definition

**Context:** Document the `/export` command so agents know how to handle it.

**Implementation:**

```markdown
---
description: Export current conversation to archive database
---

# Export Conversation Workflow

## Trigger
User types `/export` or "export this conversation"

## Steps

1. **Create temp markdown file**
   - Use `os.tmpdir()` to get system temp directory
   - Generate filename: `conversation_export_${Date.now()}.md`
   - Write full conversation history to file in markdown format

2. **Call MCP tool**
   - Tool: `export_conversation`
   - Parameters: `{file_path: <absolute_path_to_temp_file>}`
   - **Recommended metadata**: `{conversation_date: 'YYYY-MM-DD', topic: 'Brief summary', project: 'switchboard', tags: ['planning', 'bugfix']}`
   - Agent should extract conversation date from context (e.g. "today is March 29, 2026" → `2026-03-29`)
   - Agent should generate a concise topic from the conversation (e.g. "Database schema improvements")

3. **Confirm to user**
   - On success: "✅ Conversation exported to archive (ID: <conversationId>)"
   - On failure: "❌ Export failed: <error_message>"

## Notes
- Temp file is automatically deleted after successful export
- If export fails, temp file remains for debugging
- User can search archived conversations with `/search-archive <query>`
```

## Open Questions (Resolved)

1. **Title extraction**: ✅ Parse first H1 (`# Title`) or use first 50 chars of content
2. **Max conversation size**: ✅ 10MB cap is reasonable (matches typical chat session sizes)
3. **Auto-cleanup of old temp files**: ⚠️ Out of scope. If delete fails, file remains in OS temp directory (OS will eventually clean up)

## Future Enhancements (Out of Scope)

1. **Sidebar quick-copy button**: Add a "Copy /export command" button in the Database & Sync panel for easy access. Location TBD. This can be implemented as a separate enhancement once the core export functionality is working.

## Verification Plan

### Manual Verification
1. **Configure archive path:**
   - Open VS Code settings
   - Set `switchboard.archive.dbPath` to `~/.switchboard/archive.duckdb`
   - Verify DuckDB CLI installed: `duckdb --version`

2. **Test export workflow:**
   - Start a chat conversation with some content
   - Type `/export` in chat
   - **Expected Result**: Agent creates temp file, calls `export_conversation` tool, confirms success
   - **Verify**: Temp file deleted from `/tmp/` or `%TEMP%`

3. **Verify database insert:**
   - Run: `duckdb ~/.switchboard/archive.duckdb -c "SELECT id, title, exported_at FROM conversations ORDER BY exported_at DESC LIMIT 1;"`
   - **Expected Result**: Row exists with correct title and timestamp

4. **Test search:**
   - Call `search_archive` MCP tool with keyword from exported conversation
   - **Expected Result**: Returns matching conversation with snippet

5. **Test error handling:**
   - Try exporting with archive not configured: should return helpful error
   - Try exporting empty file: should reject with error
   - Try exporting 11MB file: should reject with "File too large" error

### Automated Tests
- Add unit test for title extraction logic (H1 parsing)
- Add integration test for export → search round-trip

### Build Verification
- Run `npm run compile` — no TypeScript errors
- Verify MCP tools register without errors in extension host
- Check MCP tool list includes `export_conversation` and `search_archive`

## Agent Recommendation
**Send to Coder** — This is a routine MCP tool addition following established patterns in `ArchiveManager.ts` and `register-tools.js`.

## Reviewer Pass — 2026-03-29

### Findings Summary

| # | Severity | Finding | Location |
|---|----------|---------|----------|
| 1 | CRITICAL | No schema initialization before INSERT — first export always fails if `conversations` table doesn't exist | `register-tools.js:3389-3392` (original) |
| 2 | CRITICAL | Symlink bypass in tmpdir check — `path.resolve()` doesn't follow symlinks, allowing reads outside tmpdir via symlinked files | `register-tools.js:3337-3338` (original) |
| 3 | MAJOR | Missing `-c` flag on DuckDB INSERT — SQL passed as bare positional arg instead of explicit `-c` command flag | `register-tools.js:3399` (original) |
| 4 | MAJOR | Archive path resolution copy-pasted 3× across `query_plan_archive`, `export_conversation`, `search_archive` — DRY violation | `register-tools.js:3252–3276, 3364–3385, 3425–3434` (original) |
| 5 | MAJOR | `os` module required dynamically inside each handler instead of once at module top | `register-tools.js:3325, 3410` (original) |
| 6 | NIT | `search_archive` uses ILIKE instead of planned FTS/BM25 — schema also omits FTS index. Pragmatic but divergent from plan. | `register-tools.js:3444`, `archiveSchema.sql` |
| 7 | NIT | Inconsistent error format — `export_conversation` returns `JSON.stringify({success,error})` while `search_archive` returns plain text | `register-tools.js:3397, 3451` (original) |

### Files Changed

- **`src/mcp-server/register-tools.js`**
  - Added top-level `const os = require('os')` import (line 16)
  - Extracted `resolveArchiveDbPath(workspaceRoot)` helper function (after `getWorkspaceRoot`)
  - `query_plan_archive`: replaced 15-line inline path resolution with `resolveArchiveDbPath()` call
  - `export_conversation`: replaced `path.resolve()` with `fs.realpathSync()` for symlink-safe tmpdir check; added schema initialization via `archiveSchema.sql` before INSERT; added `-c` flag to DuckDB INSERT exec; replaced inline path resolution with `resolveArchiveDbPath()`; removed dynamic `require('os')`
  - `search_archive`: replaced inline path resolution with `resolveArchiveDbPath()`; removed dynamic `require('os')`

### Validation Results

- **`npx tsc --noEmit`**: ✅ PASS (clean, zero errors)
- **Baseline was also clean**: no pre-existing type errors

### Remaining Risks

1. **ILIKE vs FTS**: `search_archive` uses `ILIKE '%...%'` for full-table-scan search. Acceptable for small archives but will degrade on large datasets. FTS index was omitted from schema — can be added as a future enhancement.
2. **SQL string interpolation**: Both `export_conversation` INSERT and `search_archive` query use string interpolation with single-quote escaping. While adequate for standard SQL, parameterized queries would be ideal. DuckDB CLI doesn't support bind parameters, so this is a known limitation.
3. **Schema init on every export**: `ensureArchiveSchema` runs the full schema SQL before each INSERT. The `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` statements are idempotent but add latency. Could be optimized with a "schema initialized" flag in a future pass.
