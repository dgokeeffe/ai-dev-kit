import { Router, Request, Response } from 'express';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { ensureProjectDirectory } from '../services/projects';
import { logger } from '../services/logger';

export const filesRouter = Router();

const IGNORED_DIRS = new Set(['.git', '__pycache__', 'node_modules', 'venv', '.venv', '.idea', '.vscode']);
const IGNORED_EXTENSIONS = new Set([
  '.pyc', '.pyo', '.so', '.o', '.a', '.exe', '.dll', '.dylib',
  '.jpg', '.jpeg', '.png', '.gif', '.ico', '.pdf', '.zip', '.tar', '.gz',
]);

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  size?: number;
  modified?: string;
}

function validatePath(projectDir: string, relativePath: string): string | null {
  const cleanPath = relativePath.replace(/^\/+/, '');
  const resolved = path.resolve(projectDir, cleanPath);
  if (!resolved.startsWith(path.resolve(projectDir))) {
    return null;
  }
  return resolved;
}

async function buildFileTree(dir: string, basePath: string, maxDepth = 10): Promise<FileNode[]> {
  if (maxDepth <= 0) return [];

  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const items: FileNode[] = [];

  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (IGNORED_DIRS.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(basePath, fullPath);

    if (entry.isDirectory()) {
      const children = await buildFileTree(fullPath, basePath, maxDepth - 1);
      items.push({ name: entry.name, path: relPath, type: 'directory', children });
    } else {
      try {
        const stat = await fsp.stat(fullPath);
        items.push({
          name: entry.name,
          path: relPath,
          type: 'file',
          size: stat.size,
          modified: new Date(stat.mtimeMs).toISOString(),
        });
      } catch {
        items.push({ name: entry.name, path: relPath, type: 'file' });
      }
    }
  }

  return items;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface SearchResult {
  path: string;
  line_number: number;
  line_content: string;
  match_start: number;
  match_end: number;
}

function matchesGlob(filename: string, relPath: string, glob: string): boolean {
  const pattern = glob.replace(/\./g, '\\.').replace(/\*/g, '.*');
  const re = new RegExp(`^${pattern}$`, 'i');
  return re.test(filename) || re.test(relPath);
}

async function searchFiles(
  dir: string,
  baseDir: string,
  pattern: RegExp,
  glob: string | undefined,
  maxResults: number,
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];

  async function walk(currentDir: string): Promise<void> {
    if (results.length >= maxResults) return;

    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= maxResults) return;
      if (entry.name.startsWith('.')) continue;

      const fullPath = path.join(currentDir, entry.name);
      const relPath = path.relative(baseDir, fullPath);

      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) {
          await walk(fullPath);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (IGNORED_EXTENSIONS.has(ext)) continue;
        if (glob && !matchesGlob(entry.name, relPath, glob)) continue;

        try {
          const content = await fsp.readFile(fullPath, 'utf-8');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length && results.length < maxResults; i++) {
            pattern.lastIndex = 0;
            const match = pattern.exec(lines[i]);
            if (match) {
              results.push({
                path: relPath,
                line_number: i + 1,
                line_content: lines[i].substring(0, 500),
                match_start: match.index,
                match_end: match.index + match[0].length,
              });
            }
          }
        } catch {
          // Skip binary/unreadable files
        }
      }
    }
  }

  await walk(dir);
  return results;
}

// GET /api/projects/:projectId/files - file tree
filesRouter.get('/projects/:projectId/files', async (req: Request, res: Response) => {
  try {
    const projectDir = ensureProjectDirectory(req.params.projectId);
    const tree = await buildFileTree(projectDir, projectDir);
    res.json(tree);
  } catch (err) {
    logger.error(`Error listing files: ${err}`);
    res.status(500).json({ detail: `Failed to list files: ${err}` });
  }
});

// GET /api/projects/:projectId/files/search - search files
// IMPORTANT: This route must be before the :encodedPath route to avoid conflicts
filesRouter.get('/projects/:projectId/files/search', async (req: Request, res: Response) => {
  try {
    const projectDir = ensureProjectDirectory(req.params.projectId);
    const queryStr = req.query.query as string;
    const caseSensitive = req.query.case_sensitive === 'true';
    const isRegex = req.query.regex === 'true';
    const glob = req.query.glob as string | undefined;

    if (!queryStr) {
      return res.status(400).json({ detail: 'Query parameter is required' });
    }

    let pattern: RegExp;
    try {
      const flags = caseSensitive ? 'g' : 'gi';
      pattern = isRegex ? new RegExp(queryStr, flags) : new RegExp(escapeRegex(queryStr), flags);
    } catch (err) {
      return res.status(400).json({ detail: `Invalid regex pattern: ${err}` });
    }

    const results = await searchFiles(projectDir, projectDir, pattern, glob, 500);
    return res.json(results);
  } catch (err) {
    logger.error(`Error searching files: ${err}`);
    return res.status(500).json({ detail: `Search failed: ${err}` });
  }
});

// GET /api/projects/:projectId/files/:encodedPath - read file
filesRouter.get('/projects/:projectId/files/:encodedPath', async (req: Request, res: Response) => {
  try {
    const projectDir = ensureProjectDirectory(req.params.projectId);
    const filePath = decodeURIComponent(req.params.encodedPath);
    const fullPath = validatePath(projectDir, filePath);
    if (!fullPath) {
      return res.status(400).json({ detail: 'Invalid path: path traversal not allowed' });
    }

    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ detail: `File not found: ${filePath}` });
    }

    const stat = await fsp.stat(fullPath);
    if (stat.isDirectory()) {
      return res.status(400).json({ detail: 'Cannot read directory as file' });
    }

    try {
      const content = await fsp.readFile(fullPath, 'utf-8');
      return res.json({
        path: filePath,
        content,
        encoding: 'utf-8',
        size: stat.size,
        modified: new Date(stat.mtimeMs).toISOString(),
      });
    } catch {
      const content = await fsp.readFile(fullPath);
      return res.json({
        path: filePath,
        content: content.toString('base64'),
        encoding: 'base64',
        size: stat.size,
        modified: new Date(stat.mtimeMs).toISOString(),
      });
    }
  } catch (err) {
    logger.error(`Error reading file: ${err}`);
    return res.status(500).json({ detail: `Failed to read file: ${err}` });
  }
});

// PUT /api/projects/:projectId/files/:encodedPath - write file
filesRouter.put('/projects/:projectId/files/:encodedPath', async (req: Request, res: Response) => {
  try {
    const projectDir = ensureProjectDirectory(req.params.projectId);
    const filePath = decodeURIComponent(req.params.encodedPath);
    const { content } = req.body;

    if (content === undefined) {
      return res.status(400).json({ detail: 'Content is required' });
    }

    const fullPath = validatePath(projectDir, filePath);
    if (!fullPath) {
      return res.status(400).json({ detail: 'Invalid path: path traversal not allowed' });
    }

    await fsp.mkdir(path.dirname(fullPath), { recursive: true });
    await fsp.writeFile(fullPath, content, 'utf-8');

    const stat = await fsp.stat(fullPath);
    return res.json({
      path: filePath,
      size: stat.size,
      modified: new Date(stat.mtimeMs).toISOString(),
    });
  } catch (err) {
    logger.error(`Error writing file: ${err}`);
    return res.status(500).json({ detail: `Failed to write file: ${err}` });
  }
});

// DELETE /api/projects/:projectId/files/:encodedPath - delete file
filesRouter.delete('/projects/:projectId/files/:encodedPath', async (req: Request, res: Response) => {
  try {
    const projectDir = ensureProjectDirectory(req.params.projectId);
    const filePath = decodeURIComponent(req.params.encodedPath);
    const fullPath = validatePath(projectDir, filePath);
    if (!fullPath) {
      return res.status(400).json({ detail: 'Invalid path: path traversal not allowed' });
    }

    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ detail: `File not found: ${filePath}` });
    }

    const stat = await fsp.stat(fullPath);
    if (stat.isDirectory()) {
      await fsp.rm(fullPath, { recursive: true });
    } else {
      await fsp.unlink(fullPath);
    }

    return res.json({ success: true, deleted_path: filePath });
  } catch (err) {
    logger.error(`Error deleting file: ${err}`);
    return res.status(500).json({ detail: `Failed to delete file: ${err}` });
  }
});

// POST /api/projects/:projectId/directories - create directory
filesRouter.post('/projects/:projectId/directories', async (req: Request, res: Response) => {
  try {
    const projectDir = ensureProjectDirectory(req.params.projectId);
    const { path: dirPath } = req.body;

    if (!dirPath) {
      return res.status(400).json({ detail: 'Path is required' });
    }

    const fullPath = validatePath(projectDir, dirPath);
    if (!fullPath) {
      return res.status(400).json({ detail: 'Invalid path: path traversal not allowed' });
    }

    await fsp.mkdir(fullPath, { recursive: true });
    return res.json({ success: true, path: dirPath });
  } catch (err) {
    logger.error(`Error creating directory: ${err}`);
    return res.status(500).json({ detail: `Failed to create directory: ${err}` });
  }
});

// POST /api/projects/:projectId/files/rename - rename file
filesRouter.post('/projects/:projectId/files/rename', async (req: Request, res: Response) => {
  try {
    const projectDir = ensureProjectDirectory(req.params.projectId);
    const { old_path, new_path } = req.body;

    if (!old_path || !new_path) {
      return res.status(400).json({ detail: 'old_path and new_path are required' });
    }

    const oldFull = validatePath(projectDir, old_path);
    const newFull = validatePath(projectDir, new_path);
    if (!oldFull || !newFull) {
      return res.status(400).json({ detail: 'Invalid path: path traversal not allowed' });
    }

    if (!fs.existsSync(oldFull)) {
      return res.status(404).json({ detail: `File not found: ${old_path}` });
    }

    await fsp.mkdir(path.dirname(newFull), { recursive: true });
    await fsp.rename(oldFull, newFull);

    return res.json({ success: true, old_path, new_path });
  } catch (err) {
    logger.error(`Error renaming file: ${err}`);
    return res.status(500).json({ detail: `Failed to rename file: ${err}` });
  }
});
