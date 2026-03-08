import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Document, Packer, Paragraph, TextRun } from 'docx';

// 20MB — heuristic upper bound for web LLM context windows (GPT-4, Claude, Gemini)
const MAX_BUNDLE_BYTES = 20 * 1024 * 1024;
// 500KB — threshold for a top-level directory to earn its own dedicated bundle file
const SIZE_THRESHOLD_BYTES = 500 * 1024;
const BINARY_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.woff', '.woff2', '.ttf', '.eot',
    '.zip', '.tar', '.gz', '.7z', '.exe', '.dll', '.so', '.dylib', '.bin',
    '.pdf', '.mp3', '.mp4', '.wav', '.avi', '.mov', '.vsix',
]);
// Used only for the non-git fallback to prevent infinite traversal of node_modules etc.
// `dist` and `out` are intentionally omitted — plugin projects may need compiled assets,
// and .gitignore is the correct mechanism for excluding them.
const EXCLUDED_DIRS = ['node_modules', '.git', '.switchboard'];

function formatTimestamp(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

async function saveAsDocx(filePath: string, content: string): Promise<void> {
    const lines = content.split('\n');
    const paragraphs: Paragraph[] = [];

    for (const line of lines) {
        const isHeader = line.startsWith('REPO:') || line.startsWith('WORKSPACE MANIFEST') ||
            line.startsWith('Generated:') || line.startsWith('Files:') ||
            line.startsWith('DIRECTORY STRUCTURE') || line.startsWith('BUNDLE TRUNCATED');
        const isSeparator = line.startsWith('--- BEGIN FILE:') || line.startsWith('--- END FILE:');

        if (isHeader) {
            paragraphs.push(new Paragraph({
                children: [new TextRun({ text: line, bold: true, font: 'Courier New', size: 20 })],
            }));
        } else if (isSeparator) {
            paragraphs.push(new Paragraph({
                children: [new TextRun({ text: line, bold: true, font: 'Courier New', size: 18, color: '666666' })],
            }));
        } else {
            paragraphs.push(new Paragraph({
                children: [new TextRun({ text: line, font: 'Courier New', size: 18 })],
            }));
        }
    }

    const doc = new Document({
        sections: [{ children: paragraphs }],
    });

    const buffer = await Packer.toBuffer(doc);
    await fs.promises.writeFile(filePath, buffer);
}

function isBinary(filePath: string): boolean {
    return BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isExcludedDir(relativePath: string): boolean {
    const parts = relativePath.split(/[\\/]/);
    return parts.some(p => EXCLUDED_DIRS.includes(p));
}


function getTopLevelDir(filePath: string): string {
    const parts = filePath.replace(/\\/g, '/').split('/');
    return parts.length > 1 ? parts[0] : '_root';
}

export async function bundleWorkspaceContext(workspaceRoot: string): Promise<string> {
    const outputDir = path.join(workspaceRoot, '.switchboard', 'airlock');

    // 1. Purge old bundles to prevent disk bloat, but preserve the directory handle for OS Explorer
    if (fs.existsSync(outputDir)) {
        const entries = await fs.promises.readdir(outputDir);
        for (const entry of entries) {
            await fs.promises.rm(path.join(outputDir, entry), { recursive: true, force: true });
        }
    } else {
        await fs.promises.mkdir(outputDir, { recursive: true });
    }

    const repoName = path.basename(workspaceRoot);

    // 2. Git-first file listing; hard-exclude .switchboard/airlock to prevent bundling previous output
    let files: string[];
    try {
        const stdout = cp.execSync('git ls-files --cached --others --exclude-standard', {
            cwd: workspaceRoot,
            encoding: 'utf8',
            maxBuffer: 10 * 1024 * 1024,
            windowsHide: true,
        });
        files = stdout.split('\n').map(f => f.trim()).filter(Boolean);
        files = files.filter(f => {
            const normalized = f.replace(/\\/g, '/');
            return !normalized.startsWith('.switchboard/airlock/') && normalized !== '.switchboard/airlock';
        });
    } catch {
        // Fallback: basic recursive scan with EXCLUDED_DIRS safeguard against node_modules traversal
        files = await walkDirectory(workspaceRoot, workspaceRoot);
    }

    // 3. Filter binary files and sort by depth (root files first)
    files = files
        .filter(f => !isBinary(f))
        .sort((a, b) => {
            const depthA = a.split(/[\\/]/).length;
            const depthB = b.split(/[\\/]/).length;
            if (depthA !== depthB) return depthA - depthB;
            return a.localeCompare(b);
        });

    // 4. Stat pass: measure per-directory total sizes to determine categorization
    const dirSizes = new Map<string, number>();
    const fileStatCache = new Map<string, number>();

    for (const file of files) {
        try {
            const stat = await fs.promises.stat(path.join(workspaceRoot, file));
            if (!stat.isFile()) { continue; }
            fileStatCache.set(file, stat.size);
            const dir = getTopLevelDir(file);
            dirSizes.set(dir, (dirSizes.get(dir) ?? 0) + stat.size);
        } catch { /* skip unreadable */ }
    }

    // 5. Directories exceeding the threshold earn a dedicated bundle; the rest consolidate into misc
    const dedicatedDirs = new Set<string>();
    for (const [dir, size] of dirSizes) {
        if (dir !== '_root' && size > SIZE_THRESHOLD_BYTES) {
            dedicatedDirs.add(dir);
        }
    }

    // 6. Single read pass: route each file into the appropriate category buffer
    const categoryBuffers = new Map<string, string>();
    const categorySizes = new Map<string, number>();

    for (const file of files) {
        const size = fileStatCache.get(file);
        if (size === undefined) { continue; }
        if (size > 512 * 1024) { continue; } // skip individually oversized files

        const topDir = getTopLevelDir(file);
        const category = dedicatedDirs.has(topDir) ? topDir : 'misc';
        const currentBytes = categorySizes.get(category) ?? 0;
        if (currentBytes >= MAX_BUNDLE_BYTES) { continue; }

        try {
            const content = await fs.promises.readFile(path.join(workspaceRoot, file), 'utf8');
            const section = `--- BEGIN FILE: ${file} ---\n${content}\n--- END FILE: ${file} ---\n\n`;
            const sectionBytes = Buffer.byteLength(section, 'utf8');

            if (currentBytes + sectionBytes > MAX_BUNDLE_BYTES) {
                categoryBuffers.set(category, (categoryBuffers.get(category) ?? '') +
                    `\nBUNDLE TRUNCATED at ${(currentBytes / 1024 / 1024).toFixed(1)}MB limit.\n`);
                categorySizes.set(category, MAX_BUNDLE_BYTES);
                continue;
            }

            categoryBuffers.set(category, (categoryBuffers.get(category) ?? '') + section);
            categorySizes.set(category, currentBytes + sectionBytes);
        } catch { /* skip unreadable */ }
    }

    // 7. Write all bundles and manifest concurrently as .docx
    const now = new Date();
    const generatedAt = now.toISOString();
    const timestamp = formatTimestamp(now);
    const writePromises: Promise<void>[] = [];

    for (const [category, content] of categoryBuffers) {
        const header = `REPO: ${repoName} — ${category}\nGenerated: ${generatedAt}\n\n`;
        writePromises.push(
            saveAsDocx(path.join(outputDir, `${timestamp}-${repoName}-${category}.docx`), header + content)
        );
    }

    const manifestContent = `WORKSPACE MANIFEST\nGenerated: ${generatedAt}\nFiles: ${files.length}\n\nDIRECTORY STRUCTURE\n${files.join('\n')}\n`;
    writePromises.push(
        saveAsDocx(path.join(outputDir, `${timestamp}-manifest.docx`), manifestContent)
    );

    await Promise.all(writePromises);
    return outputDir;
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
