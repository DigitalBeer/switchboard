import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const MAX_BUNDLE_BYTES = 5 * 1024 * 1024; // 5MB cap
const BINARY_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.woff', '.woff2', '.ttf', '.eot',
    '.zip', '.tar', '.gz', '.7z', '.exe', '.dll', '.so', '.dylib', '.bin',
    '.pdf', '.mp3', '.mp4', '.wav', '.avi', '.mov', '.vsix',
]);
const EXCLUDED_DIRS = ['node_modules', 'dist', 'out', '.git', '.switchboard'];

function isBinary(filePath: string): boolean {
    return BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isExcludedDir(relativePath: string): boolean {
    const parts = relativePath.split(/[\\/]/);
    return parts.some(p => EXCLUDED_DIRS.includes(p));
}

export async function bundleWorkspaceContext(workspaceRoot: string): Promise<string> {
    const outputDir = path.join(workspaceRoot, '.switchboard');
    await fs.promises.mkdir(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, 'notebooklm-context.md');

    // Use git ls-files for .gitignore-compliant listing
    let files: string[];
    try {
        const stdout = cp.execSync('git ls-files --cached --others --exclude-standard', {
            cwd: workspaceRoot,
            encoding: 'utf8',
            maxBuffer: 10 * 1024 * 1024,
            windowsHide: true,
        });
        files = stdout.split('\n').map(f => f.trim()).filter(Boolean);
    } catch {
        // Fallback: basic recursive scan if not a git repo
        files = await walkDirectory(workspaceRoot, workspaceRoot);
    }

    // Filter
    files = files.filter(f => !isBinary(f) && !isExcludedDir(f));

    let bundle = `# Workspace Context Bundle\n\nGenerated: ${new Date().toISOString()}\nFiles: ${files.length}\n\n---\n\n`;
    let totalBytes = Buffer.byteLength(bundle, 'utf8');
    let truncated = false;

    for (const file of files) {
        const absPath = path.join(workspaceRoot, file);
        try {
            const stat = await fs.promises.stat(absPath);
            if (!stat.isFile() || stat.size > 512 * 1024) { continue; } // skip files > 512KB individually
            const content = await fs.promises.readFile(absPath, 'utf8');
            const section = `## File: ${file}\n\n\`\`\`\n${content}\n\`\`\`\n\n`;
            const sectionBytes = Buffer.byteLength(section, 'utf8');
            if (totalBytes + sectionBytes > MAX_BUNDLE_BYTES) {
                bundle += `\n\n> ⚠️ Bundle truncated at ${(totalBytes / 1024 / 1024).toFixed(1)}MB limit. ${files.length - files.indexOf(file)} files omitted.\n`;
                truncated = true;
                break;
            }
            bundle += section;
            totalBytes += sectionBytes;
        } catch {
            // Skip unreadable files
        }
    }

    await fs.promises.writeFile(outputPath, bundle, 'utf8');
    return outputPath;
}

async function walkDirectory(dir: string, root: string): Promise<string[]> {
    const results: string[] = [];
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const rel = path.relative(root, fullPath);
        if (isExcludedDir(rel)) { continue; }
        if (entry.isDirectory()) {
            results.push(...await walkDirectory(fullPath, root));
        } else if (entry.isFile()) {
            results.push(rel);
        }
    }
    return results;
}
