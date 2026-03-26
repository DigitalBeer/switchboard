# Fix GitHub Copilot MCP Auto-Setup — Incomplete IDE Integration

## Goal

The Switchboard MCP auto-setup is incomplete for GitHub Copilot. When a user selects "GitHub Copilot" in the setup wizard or triggers "Connect MCP", the extension writes instruction/agent markdown files (`.github/copilot-instructions.md`, `.github/agents/switchboard.agent.md`) but does **not** ensure the MCP server config in `.vscode/mcp.json` is created or refreshed through the standard IDE config pipeline. While `performSetup()` does write `.vscode/mcp.json` directly (lines 2641–2670), the "Connect MCP" refresh path (`writeAllIdeMcpConfigs()`) skips GitHub entirely because `github` is missing from the `ideKeys` array and from `getMcpConfigFilesForIDE()`. Additionally, the `performSetup()` write to `.vscode/mcp.json` omits the `SWITCHBOARD_WORKSPACE_ROOT` environment variable that every other IDE config sets.

The fix must:
1. Add `github` to `getMcpConfigFilesForIDE()` so the system knows `.vscode/mcp.json` is the MCP config destination for GitHub Copilot.
2. Add `github` to the `ideKeys` in `writeAllIdeMcpConfigs()` so "Connect MCP" refreshes the Copilot config.
3. Handle GitHub Copilot's different JSON schema (`servers` key with `type: 'stdio'` instead of `mcpServers` key) inside `writeAllIdeMcpConfigs()`.
4. Add the `SWITCHBOARD_WORKSPACE_ROOT` env var to the `.vscode/mcp.json` entry in `performSetup()` for consistency with all other IDE configs.
5. Add `mcp.json.template` to `getConfigFilesForIDE('github')` so initial setup also writes MCP config through the template pipeline.
6. Create the `templates/github/mcp.json.template` template file.

## User Review Required

- Confirm that `.vscode/mcp.json` under the `servers` key (with `type: 'stdio'`) is the correct and current format for GitHub Copilot's MCP client. The older `.vscode/settings.json` under `mcpServers` (written by `handleMcpSetup()`) may also still be needed — review whether both should be maintained or if one is deprecated.
- Confirm whether `${workspaceFolder}` (a VS Code variable) should be used in `.vscode/mcp.json` args instead of absolute paths. Currently `performSetup()` uses `${workspaceFolder}` but `writeAllIdeMcpConfigs()` uses absolute paths for all other IDEs.

## Complexity Audit

**Manual Complexity Override:** Low


### Routine

- **Creating `templates/github/mcp.json.template`**: Straightforward file creation following the exact pattern of existing templates (`templates/cursor/mcp.json.template`, etc.), adapted for the `.vscode/mcp.json` schema (`servers` key, `type: 'stdio'`).
- **Adding `github` to `getMcpConfigFilesForIDE()`**: Single entry addition to an existing record mapping. Follows the exact pattern of the five existing IDE entries.
- **Adding MCP config to `getConfigFilesForIDE('github')`**: Appending one object to an existing array. Same pattern as windsurf/cursor which already include MCP config entries alongside instruction files.
- **Adding `SWITCHBOARD_WORKSPACE_ROOT` env to `performSetup()`'s `.vscode/mcp.json` write**: Adding an `env` property to the existing `expectedSwitchboardEntry` object literal (lines 2651–2655).

### Complex / Risky
- None.


## Edge-Case & Dependency Audit

1. **`.vscode/mcp.json` already exists with non-Switchboard servers**: The merge logic must preserve other `servers` entries. The existing `writeAllIdeMcpConfigs()` already handles this pattern for `mcpServers` — the github branch must replicate this under `servers`.

2. **`.vscode/mcp.json` is corrupt or non-JSON**: Must catch parse errors and fall back to `{ servers: {} }`, same as existing error handling for other IDEs.

3. **`.vscode/` directory doesn't exist**: Must create the directory before writing. The existing `performSetup()` already does `createDirectory(vscodeDirUri)` — `writeAllIdeMcpConfigs()` already has `mkdirSync(destDir, { recursive: true })` which handles this.

4. **Template substitution for `${workspaceFolder}`**: The template uses literal `${workspaceFolder}` (a VS Code variable, not a Switchboard template variable). The template engine must NOT substitute this — it should pass through as-is. However, `performSetup()` replaces `{{WORKSPACE_ROOT}}` in templates. So the template should use `{{WORKSPACE_ROOT}}` where an absolute path is needed, and literal `${workspaceFolder}` where VS Code variable substitution is desired. Since `.vscode/mcp.json` is a VS Code config, it should use `${workspaceFolder}`.

5. **`writeAllIdeMcpConfigs()` uses absolute paths but `.vscode/mcp.json` should use `${workspaceFolder}`**: The programmatic write in `writeAllIdeMcpConfigs()` builds `newEntry` using `absWorkspaceRoot`. For the github branch, it should use `${workspaceFolder}` literal string instead, since VS Code resolves this variable at runtime.

6. **Multi-root workspace**: `handleMcpSetup()` already handles multi-root workspace detection. The new code should work correctly because `.vscode/mcp.json` is workspace-scoped and `${workspaceFolder}` resolves per-workspace.

7. **No-op detection**: The function already compares `currentJson.trim() === newJson.trim()` to skip unnecessary writes. This works for the github path too since the JSON structure is deterministic.

## Adversarial Synthesis

### Grumpy Critique

Oh wonderful, another "just add one IDE" change that's actually a landmine factory. Let me count the ways this will blow up:

**First**, you're bolting a fundamentally different JSON schema onto a function that was clearly designed for one schema. The `writeAllIdeMcpConfigs()` function has ONE job — write `mcpServers` objects. Now you want it to also write `servers` objects with `type: 'stdio'`? That's not "adding github support," that's turning a clean single-purpose function into a branching mess with special-case spaghetti. "If it's github, do this completely different thing" — yeah, that's a design smell so strong I can taste it from here.

**Second**, you've got TWO separate code paths writing MCP config for the same IDE. `performSetup()` writes `.vscode/mcp.json` with `${workspaceFolder}` and no `env`. `handleMcpSetup()` writes `.vscode/settings.json` with absolute paths and `env`. And NOW you want `writeAllIdeMcpConfigs()` to ALSO write `.vscode/mcp.json`? That's three writers, two files, two schemas. When something breaks, good luck figuring out which writer last touched which file with which format. You're building a debugging nightmare.

**Third**, the template you're creating (`templates/github/mcp.json.template`) will use `{{WORKSPACE_ROOT}}` for substitution during initial setup. But `writeAllIdeMcpConfigs()` doesn't use templates at all — it builds config programmatically. So the template and the programmatic path could easily drift apart, producing different configs depending on whether the user ran "Setup" or "Connect MCP." Congratulations, you've invented config schizophrenia.

**Fourth**, you're casually using `${workspaceFolder}` as a literal string in `writeAllIdeMcpConfigs()`. That's a VS Code variable that only resolves inside VS Code. If anyone ever copies that config file, references it from a CLI tool, or uses it outside VS Code, they get a broken path pointing to literally `${workspaceFolder}/.switchboard/MCP/mcp-server.js`. At least the other IDEs use real absolute paths that work everywhere.

**Fifth**, the `SWITCHBOARD_WORKSPACE_ROOT` env var addition to `performSetup()` is solving a problem that doesn't exist. The `${workspaceFolder}` variable already resolves the workspace root. Adding `env` to a config that uses VS Code variables is belt-and-suspenders cargo culting. Unless the MCP server actually reads `SWITCHBOARD_WORKSPACE_ROOT` at startup and ignores its working directory — in which case, fine, but DOCUMENT that dependency.

### Balanced Response

The grumpy critique raises valid architectural concerns. Here's the pragmatic assessment:

1. **Schema branching in `writeAllIdeMcpConfigs()` is necessary but should be minimal.** The function already does per-IDE destination routing via `getMcpConfigFilesForIDE()`. Adding a schema branch for github is inelegant but pragmatic. A larger refactor (e.g., per-IDE writer classes) would be over-engineering for one exception. The branch should be clearly commented and isolated to ~10 lines.

2. **Multiple writers for github config is a real concern, but manageable.** `handleMcpSetup()` writes `.vscode/settings.json` (old format), `performSetup()` writes `.vscode/mcp.json` (new format), and `writeAllIdeMcpConfigs()` will refresh `.vscode/mcp.json`. The key insight: `handleMcpSetup()` targets a different file, and `performSetup()` vs `writeAllIdeMcpConfigs()` produce the same output. They're not conflicting — they're complementary paths (initial setup vs refresh). Add a code comment linking them.

3. **Template vs programmatic drift is low-risk.** The template is only used once (initial setup). The programmatic path runs on every refresh. Both produce the same JSON structure — any drift would be caught by the no-op detection (JSON comparison). But we should add a comment in both locations cross-referencing each other.

4. **`${workspaceFolder}` is correct for VS Code configs.** This is a VS Code-native config file read by VS Code's built-in MCP client. Using VS Code variables is the canonical approach. Other IDEs use absolute paths because they have their own config systems. The grumpy concern about CLI portability doesn't apply here — `.vscode/mcp.json` is exclusively a VS Code file.

5. **Adding `SWITCHBOARD_WORKSPACE_ROOT` env to `performSetup()` is justified.** The MCP server (`mcp-server.js`) reads this env var to resolve workspace-relative paths. All other IDE configs set it. The `.vscode/mcp.json` entry should set it too for consistency and to avoid a subtle bug if the server relies on it. The env var complements `${workspaceFolder}` — one is resolved by VS Code (for the args path), the other is read by the server process (for internal logic).

## Proposed Changes

### 1. Extension Source — MCP Config Registration

#### MODIFY `src/extension.ts`

- **Context:** `getMcpConfigFilesForIDE()` function (lines 3008–3017). This function maps IDE names to their MCP config file destinations. It currently has entries for `windsurf`, `cursor`, `claude`, `gemini`, and `kiro` — but not `github`.
- **Logic:** Add a `github` entry mapping to `.vscode/mcp.json` as the MCP config destination.
- **Implementation:**
  ```typescript
  // Inside getMcpConfigFilesForIDE(), add to the mcpConfigs record:
  github: [{ template: 'mcp.json.template', destination: '.vscode/mcp.json' }],
  ```
- **Edge Cases Handled:** Returns empty array for unknown IDE keys (existing fallback `return mcpConfigs[ide] || []` unchanged).

### 2. Extension Source — IDE Config File Registry

#### MODIFY `src/extension.ts`

- **Context:** `getConfigFilesForIDE()` function (lines 2976–3003). The `github` entry currently only lists instruction/agent markdown files, not the MCP config.
- **Logic:** Add the `.vscode/mcp.json` MCP config file to the `github` entry so that initial setup (`performSetup()`) writes MCP config through the template pipeline in addition to the direct write.
- **Implementation:**
  ```typescript
  // In getConfigFilesForIDE(), update the github entry:
  github: [
      { template: 'copilot-instructions.md.template', destination: '.github/copilot-instructions.md' },
      { template: 'agents/switchboard.agent.md.template', destination: '.github/agents/switchboard.agent.md' },
      { template: 'mcp.json.template', destination: '.vscode/mcp.json' }
  ],
  ```
- **Edge Cases Handled:** The template pipeline replaces `{{WORKSPACE_ROOT}}` — but `.vscode/mcp.json` should use literal `${workspaceFolder}`. The template must NOT use `{{WORKSPACE_ROOT}}` in the args path. Instead it uses the VS Code variable directly, which the template engine passes through unchanged because it doesn't match the `{{...}}` pattern.

### 3. Extension Source — Connect MCP Refresh Path

#### MODIFY `src/extension.ts`

- **Context:** `writeAllIdeMcpConfigs()` function (lines 3025–3106). The `ideKeys` array is `['windsurf', 'cursor', 'claude', 'gemini', 'kiro']` — missing `github`. The function body assumes all IDEs use the `mcpServers` top-level key.
- **Logic:** Add `'github'` to `ideKeys`. Add a conditional branch that, when `ide === 'github'`, uses the `servers` top-level key, includes `type: 'stdio'` in the entry, and uses `${workspaceFolder}` instead of `absWorkspaceRoot` in the args path.
- **Implementation:**
  ```typescript
  // 1. Update ideKeys:
  const ideKeys = ['windsurf', 'cursor', 'claude', 'gemini', 'kiro', 'github'];

  // 2. Inside the for loop, after building newEntry, add github-specific handling:
  const isGitHub = ide === 'github';

  const newEntry = isGitHub
      ? {
          type: 'stdio' as const,
          command: 'node',
          args: ['${workspaceFolder}/.switchboard/MCP/mcp-server.js'],
          env: { SWITCHBOARD_WORKSPACE_ROOT: absWorkspaceRoot }
      }
      : {
          command: 'node',
          args: [path.join(absWorkspaceRoot, '.switchboard', 'MCP', 'mcp-server.js')],
          env: { SWITCHBOARD_WORKSPACE_ROOT: absWorkspaceRoot }
      };

  // 3. Update the merge logic to use the correct top-level key:
  const mcpKey = isGitHub ? 'servers' : 'mcpServers';

  if (!existingConfig[mcpKey]) {
      existingConfig[mcpKey] = {};
  }

  const updatedConfig = {
      ...existingConfig,
      [mcpKey]: {
          ...existingConfig[mcpKey],
          switchboard: newEntry
      }
  };
  ```
- **Edge Cases Handled:**
  - Existing `.vscode/mcp.json` with other server entries under `servers` key — preserved by spread merge.
  - Corrupt `.vscode/mcp.json` — caught by existing try/catch, falls back to empty object.
  - `.vscode/` directory missing — handled by existing `mkdirSync(destDir, { recursive: true })`.
  - No-op detection — existing JSON comparison still works since output is deterministic.

### 4. Extension Source — performSetup() MCP Config

#### MODIFY `src/extension.ts`

- **Context:** `performSetup()` function, lines 2641–2670. The `expectedSwitchboardEntry` written to `.vscode/mcp.json` lacks the `env` property that all other IDE configs include.
- **Logic:** Add `env: { SWITCHBOARD_WORKSPACE_ROOT: ... }` to the entry object so the MCP server process receives the workspace root via environment variable, consistent with all other IDE configs.
- **Implementation:**
  ```typescript
  // Update the expectedSwitchboardEntry object:
  const expectedSwitchboardEntry = {
      type: 'stdio',
      command: 'node',
      args: ['${workspaceFolder}/.switchboard/MCP/mcp-server.js'],
      env: {
          SWITCHBOARD_WORKSPACE_ROOT: workspaceRoot.replace(/\\/g, '/')
      }
  };
  ```
  Where `workspaceRoot` is the absolute workspace root path already available in scope.
- **Edge Cases Handled:** Existing `.vscode/mcp.json` entries are merged (existing behavior) — the env addition only affects the `switchboard` entry.

### 5. Template File — GitHub Copilot MCP Config

#### CREATE `templates/github/mcp.json.template`

- **Context:** Every other IDE has a template in `templates/<ide>/`. GitHub Copilot is missing one. This template is used by `performSetup()` when processing config files from `getConfigFilesForIDE('github')`.
- **Logic:** Create the template matching the `.vscode/mcp.json` schema that VS Code's Copilot MCP client expects: `servers` top-level key, `type: 'stdio'`, and `${workspaceFolder}` for the server path. Include `SWITCHBOARD_WORKSPACE_ROOT` env var using `{{WORKSPACE_ROOT}}` template variable for the absolute path.
- **Implementation:**
  ```json
  {
    "servers": {
      "switchboard": {
        "type": "stdio",
        "command": "node",
        "args": ["${workspaceFolder}/.switchboard/MCP/mcp-server.js"],
        "env": {
          "SWITCHBOARD_WORKSPACE_ROOT": "{{WORKSPACE_ROOT}}"
        }
      }
    }
  }
  ```
- **Edge Cases Handled:** `${workspaceFolder}` is a literal VS Code variable that passes through the `{{...}}` template engine untouched. `{{WORKSPACE_ROOT}}` is substituted with the absolute workspace path by the setup pipeline.

## Verification Plan

### Automated Tests

- If unit tests exist for `getMcpConfigFilesForIDE()`, `getConfigFilesForIDE()`, or `writeAllIdeMcpConfigs()`, update them to assert:
  - `getMcpConfigFilesForIDE('github')` returns `[{ template: 'mcp.json.template', destination: '.vscode/mcp.json' }]`
  - `getConfigFilesForIDE('github')` returns three entries (two markdown + one MCP config)
- Run the full build (`npm run compile` or `npm run build`) to catch TypeScript errors from the schema branching in `writeAllIdeMcpConfigs()`.

### Manual Tests

1. **Setup Wizard — GitHub Copilot selection:**
   - Open Command Palette → "Switchboard: Setup for IDEs"
   - Select "GitHub Copilot" only
   - Verify `.github/copilot-instructions.md` is created ✅
   - Verify `.github/agents/switchboard.agent.md` is created ✅
   - Verify `.vscode/mcp.json` is created with correct `servers.switchboard` entry including `type: 'stdio'`, `command: 'node'`, `args` with `${workspaceFolder}`, and `env.SWITCHBOARD_WORKSPACE_ROOT` ✅

2. **Connect MCP refresh:**
   - Delete `.vscode/mcp.json`
   - Trigger "Connect MCP" command
   - Verify `.vscode/mcp.json` is recreated with correct schema
   - Verify other IDE configs (e.g., `.cursor/mcp.json`) are also refreshed and unchanged

3. **Merge preservation:**
   - Manually add a non-Switchboard server to `.vscode/mcp.json` under `servers`
   - Trigger "Connect MCP"
   - Verify the non-Switchboard server entry is preserved

4. **Copilot MCP client connectivity:**
   - After setup, open GitHub Copilot Chat in VS Code
   - Verify Switchboard MCP tools appear in Copilot's tool list
   - Execute a simple MCP tool call to confirm the connection works end-to-end

5. **No regression — other IDEs:**
   - Run setup with all IDEs selected
   - Verify all IDE configs are written correctly (windsurf, cursor, claude, gemini, kiro, github)
   - Verify no format contamination (e.g., `servers` key doesn't leak into cursor config)

## Recommendation

Send to Coder — the changes are well-scoped to five specific locations in `extension.ts` plus one new template file. The branching logic in `writeAllIdeMcpConfigs()` requires careful implementation but is straightforward with the schema details documented above.
