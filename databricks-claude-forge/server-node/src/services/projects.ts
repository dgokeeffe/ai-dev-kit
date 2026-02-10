import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { logger } from './logger';
import { isPostgresConfigured, query } from '../db/database';
import * as convService from './conversations';

const PROJECTS_BASE_DIR = process.env.PROJECTS_BASE_DIR || './projects';

export interface ProjectResponse {
  id: string;
  name: string;
  user_email: string;
  created_at: string;
  conversations: convService.ConversationResponse[];
}

interface StoredProject {
  id: string;
  name: string;
  user_email: string;
  created_at: string;
}

// In-memory store (fallback when DB not available)
const memProjects: Map<string, StoredProject> = new Map();

export function ensureProjectDirectory(projectId: string): string {
  const dir = path.resolve(PROJECTS_BASE_DIR, projectId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    logger.info(`Created project directory: ${dir}`);
  }
  return dir;
}

export function getProjectDirectory(projectId: string): string {
  return path.resolve(PROJECTS_BASE_DIR, projectId);
}

function toResponse(project: StoredProject, conversations: convService.ConversationResponse[] = []): ProjectResponse {
  return {
    id: project.id,
    name: project.name,
    user_email: project.user_email,
    created_at: project.created_at,
    conversations,
  };
}

export async function createProject(name: string, userEmail: string): Promise<ProjectResponse> {
  const id = uuidv4();
  const createdAt = new Date().toISOString();

  const project: StoredProject = { id, name, user_email: userEmail, created_at: createdAt };

  if (isPostgresConfigured()) {
    try {
      await query(
        'INSERT INTO projects (id, name, user_email, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)',
        [id, name, userEmail, createdAt]
      );
    } catch (err) {
      logger.warn(`DB insert failed, using in-memory: ${err}`);
      memProjects.set(id, project);
    }
  } else {
    memProjects.set(id, project);
  }

  const projectDir = ensureProjectDirectory(id);
  const claudeMdPath = path.join(projectDir, 'CLAUDE.md');
  if (!fs.existsSync(claudeMdPath)) {
    fs.writeFileSync(claudeMdPath, `# ${name}\n\nProject created ${createdAt}\n`);
  }

  logger.info(`Created project ${id}: ${name}`);
  return toResponse(project, []);
}

export async function getProjects(userEmail: string): Promise<ProjectResponse[]> {
  let projects: StoredProject[];

  if (isPostgresConfigured()) {
    try {
      const result = await query(
        'SELECT id, name, user_email, created_at FROM projects WHERE user_email = $1 ORDER BY created_at DESC',
        [userEmail]
      );
      projects = result.rows.map((r) => ({
        id: r.id as string,
        name: r.name as string,
        user_email: r.user_email as string,
        created_at: (r.created_at as Date).toISOString(),
      }));
    } catch (err) {
      logger.warn(`DB query failed, using in-memory: ${err}`);
      projects = Array.from(memProjects.values())
        .filter((p) => p.user_email === userEmail)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }
  } else {
    projects = Array.from(memProjects.values())
      .filter((p) => p.user_email === userEmail)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  const responses: ProjectResponse[] = [];
  for (const p of projects) {
    const conversations = await convService.getConversations(p.id, userEmail);
    responses.push(toResponse(p, conversations));
  }
  return responses;
}

export async function getProject(projectId: string, userEmail: string): Promise<ProjectResponse | null> {
  let project: StoredProject | null = null;

  if (isPostgresConfigured()) {
    try {
      const result = await query(
        'SELECT id, name, user_email, created_at FROM projects WHERE id = $1 AND user_email = $2',
        [projectId, userEmail]
      );
      if (result.rows.length > 0) {
        const r = result.rows[0];
        project = {
          id: r.id as string,
          name: r.name as string,
          user_email: r.user_email as string,
          created_at: (r.created_at as Date).toISOString(),
        };
      }
    } catch (err) {
      logger.warn(`DB query failed, using in-memory: ${err}`);
      const mem = memProjects.get(projectId);
      project = (mem && mem.user_email === userEmail) ? mem : null;
    }
  } else {
    const mem = memProjects.get(projectId);
    project = (mem && mem.user_email === userEmail) ? mem : null;
  }

  if (!project) return null;

  const conversations = await convService.getConversations(projectId, userEmail);
  return toResponse(project, conversations);
}

export async function updateProject(projectId: string, name: string, userEmail: string): Promise<boolean> {
  if (isPostgresConfigured()) {
    try {
      const result = await query(
        'UPDATE projects SET name = $1, updated_at = NOW() WHERE id = $2 AND user_email = $3',
        [name, projectId, userEmail]
      );
      if (result.rowCount && result.rowCount > 0) return true;
    } catch (err) {
      logger.warn(`DB update failed, trying in-memory: ${err}`);
    }
  }

  const project = memProjects.get(projectId);
  if (!project || project.user_email !== userEmail) return false;
  project.name = name;
  return true;
}

export async function deleteProject(projectId: string, userEmail: string): Promise<boolean> {
  let deleted = false;

  if (isPostgresConfigured()) {
    try {
      const result = await query(
        'DELETE FROM projects WHERE id = $1 AND user_email = $2',
        [projectId, userEmail]
      );
      deleted = !!(result.rowCount && result.rowCount > 0);
    } catch (err) {
      logger.warn(`DB delete failed, trying in-memory: ${err}`);
    }
  }

  if (!deleted) {
    const project = memProjects.get(projectId);
    if (!project || project.user_email !== userEmail) return false;
    memProjects.delete(projectId);
    deleted = true;
  }

  // Delete associated conversations
  await convService.deleteConversationsForProject(projectId);

  // Delete project directory
  const dir = getProjectDirectory(projectId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  return deleted;
}
