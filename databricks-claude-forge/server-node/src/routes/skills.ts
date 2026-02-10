import { Router, Request, Response } from 'express';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { getProjectDirectory, ensureProjectDirectory } from '../services/projects';
import { logger } from '../services/logger';

export const skillsRouter = Router();

interface SkillTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: SkillTreeNode[];
}

function getSkillsDir(projectId: string): string {
  return path.join(getProjectDirectory(projectId), '.claude', 'skills');
}

function buildTreeNode(fullPath: string, basePath: string): SkillTreeNode {
  const name = path.basename(fullPath);
  const relPath = path.relative(basePath, fullPath);
  const stat = fs.statSync(fullPath);

  if (stat.isDirectory()) {
    const children: SkillTreeNode[] = [];
    const entries = fs.readdirSync(fullPath).sort((a, b) => {
      const aIsDir = fs.statSync(path.join(fullPath, a)).isDirectory();
      const bIsDir = fs.statSync(path.join(fullPath, b)).isDirectory();
      if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
      return a.localeCompare(b, undefined, { sensitivity: 'base' });
    });

    for (const entry of entries) {
      if (entry.startsWith('.') || entry === '__pycache__') continue;
      children.push(buildTreeNode(path.join(fullPath, entry), basePath));
    }

    return { name, path: relPath, type: 'directory', children };
  }

  return { name, path: relPath, type: 'file' };
}

// GET /api/projects/:projectId/skills - list skills
skillsRouter.get('/projects/:projectId/skills', (req: Request, res: Response) => {
  try {
    const skillsDir = getSkillsDir(req.params.projectId);

    if (!fs.existsSync(skillsDir)) {
      return res.json([]);
    }

    const skills: Array<{ name: string; description: string; content?: string }> = [];
    const entries = fs.readdirSync(skillsDir);

    for (const entry of entries) {
      if (entry.startsWith('.')) continue;
      const entryPath = path.join(skillsDir, entry);
      const stat = fs.statSync(entryPath);

      if (stat.isDirectory()) {
        // Look for SKILL.md in the directory
        const skillMd = path.join(entryPath, 'SKILL.md');
        if (fs.existsSync(skillMd)) {
          const content = fs.readFileSync(skillMd, 'utf-8');
          // Extract description from first line or heading
          const lines = content.split('\n').filter((l) => l.trim());
          const description = lines.find((l) => !l.startsWith('#'))?.trim() || entry;
          skills.push({ name: entry, description, content });
        }
      }
    }

    return res.json(skills);
  } catch (err) {
    logger.error(`Error listing skills: ${err}`);
    return res.status(500).json({ detail: String(err) });
  }
});

// GET /api/projects/:projectId/skills/tree - skills file tree
// Returns array directly (not wrapped in { tree: [...] }) per frontend contract
skillsRouter.get('/projects/:projectId/skills/tree', (req: Request, res: Response) => {
  try {
    const skillsDir = getSkillsDir(req.params.projectId);

    if (!fs.existsSync(skillsDir)) {
      return res.json([]);
    }

    const tree: SkillTreeNode[] = [];
    const entries = fs.readdirSync(skillsDir).sort((a, b) => {
      const aPath = path.join(skillsDir, a);
      const bPath = path.join(skillsDir, b);
      const aIsDir = fs.statSync(aPath).isDirectory();
      const bIsDir = fs.statSync(bPath).isDirectory();
      if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
      return a.localeCompare(b, undefined, { sensitivity: 'base' });
    });

    for (const entry of entries) {
      if (entry.startsWith('.')) continue;
      tree.push(buildTreeNode(path.join(skillsDir, entry), skillsDir));
    }

    return res.json(tree);
  } catch (err) {
    logger.error(`Error getting skills tree: ${err}`);
    return res.status(500).json({ detail: String(err) });
  }
});

// GET /api/projects/:projectId/skills/file/:encodedPath - get skill file
skillsRouter.get('/projects/:projectId/skills/file/:encodedPath', (req: Request, res: Response) => {
  try {
    const skillsDir = getSkillsDir(req.params.projectId);
    const filePath = decodeURIComponent(req.params.encodedPath);

    // Security: resolve and check for traversal
    const resolved = path.resolve(skillsDir, filePath);
    if (!resolved.startsWith(path.resolve(skillsDir))) {
      return res.status(403).json({ detail: 'Access denied: path outside skills directory' });
    }

    if (!fs.existsSync(resolved)) {
      return res.status(404).json({ detail: 'File not found' });
    }

    const stat = fs.statSync(resolved);
    if (!stat.isFile()) {
      return res.status(400).json({ detail: 'Path is not a file' });
    }

    const content = fs.readFileSync(resolved, 'utf-8');
    return res.json({ path: filePath, content });
  } catch (err) {
    logger.error(`Error reading skill file: ${err}`);
    return res.status(500).json({ detail: String(err) });
  }
});

// GET /api/projects/:projectId/skills/:skillName - get skill content
skillsRouter.get('/projects/:projectId/skills/:skillName', (req: Request, res: Response) => {
  try {
    const skillsDir = getSkillsDir(req.params.projectId);
    const skillName = req.params.skillName;

    // Check for SKILL.md in skill directory
    const skillMd = path.join(skillsDir, skillName, 'SKILL.md');
    if (fs.existsSync(skillMd)) {
      const content = fs.readFileSync(skillMd, 'utf-8');
      const lines = content.split('\n').filter((l) => l.trim());
      const description = lines.find((l) => !l.startsWith('#'))?.trim() || skillName;
      return res.json({ name: skillName, description, content });
    }

    return res.status(404).json({ detail: `Skill ${skillName} not found` });
  } catch (err) {
    logger.error(`Error getting skill: ${err}`);
    return res.status(500).json({ detail: String(err) });
  }
});

// POST /api/projects/:projectId/skills/reload - reload skills
skillsRouter.post('/projects/:projectId/skills/reload', (req: Request, res: Response) => {
  try {
    const projectDir = ensureProjectDirectory(req.params.projectId);
    const skillsDir = path.join(projectDir, '.claude', 'skills');

    // Copy skills from source (sibling directory)
    const sourceDir = path.resolve(projectDir, '../../databricks-skills');

    if (!fs.existsSync(sourceDir)) {
      return res.json({ success: true, message: 'No skills source found - nothing to reload' });
    }

    // Remove existing skills and re-copy
    if (fs.existsSync(skillsDir)) {
      fs.rmSync(skillsDir, { recursive: true, force: true });
    }
    fs.mkdirSync(skillsDir, { recursive: true });

    const skillDirs = fs.readdirSync(sourceDir);
    for (const skillDir of skillDirs) {
      if (skillDir === 'TEMPLATE' || skillDir.startsWith('.')) continue;
      const src = path.join(sourceDir, skillDir);
      const stat = fs.statSync(src);
      if (stat.isDirectory() && fs.existsSync(path.join(src, 'SKILL.md'))) {
        copyDirSync(src, path.join(skillsDir, skillDir));
      }
    }

    return res.json({ success: true, message: 'Skills reloaded successfully' });
  } catch (err) {
    logger.error(`Error reloading skills: ${err}`);
    return res.status(500).json({ detail: String(err) });
  }
});

function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
