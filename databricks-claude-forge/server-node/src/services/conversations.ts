import { v4 as uuidv4 } from 'uuid';
import { logger } from './logger';
import { isPostgresConfigured, query } from '../db/database';

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  is_error: boolean;
}

// Response type without messages (used in project responses and list views)
export interface ConversationResponse {
  id: string;
  project_id: string;
  title: string;
  created_at: string;
  session_id?: string;
  cluster_id?: string;
  warehouse_id?: string;
  default_catalog?: string;
  default_schema?: string;
  workspace_folder?: string;
}

// Full response type with messages (used in single conversation view)
export interface ConversationWithMessages extends ConversationResponse {
  messages: Message[];
}

interface StoredConversation {
  id: string;
  project_id: string;
  title: string;
  created_at: string;
  session_id?: string;
  cluster_id?: string;
  warehouse_id?: string;
  default_catalog?: string;
  default_schema?: string;
  workspace_folder?: string;
  messages: Message[];
}

// In-memory store (fallback when DB not available)
const memConversations: Map<string, StoredConversation> = new Map();

function toSummary(conv: StoredConversation): ConversationResponse {
  return {
    id: conv.id,
    project_id: conv.project_id,
    title: conv.title,
    created_at: conv.created_at,
    session_id: conv.session_id,
    cluster_id: conv.cluster_id,
    warehouse_id: conv.warehouse_id,
    default_catalog: conv.default_catalog,
    default_schema: conv.default_schema,
    workspace_folder: conv.workspace_folder,
  };
}

function toFull(conv: StoredConversation): ConversationWithMessages {
  return {
    ...toSummary(conv),
    messages: conv.messages,
  };
}

function rowToConv(r: Record<string, unknown>): StoredConversation {
  return {
    id: r.id as string,
    project_id: r.project_id as string,
    title: r.title as string,
    created_at: (r.created_at as Date).toISOString(),
    session_id: r.session_id as string | undefined,
    cluster_id: r.cluster_id as string | undefined,
    warehouse_id: r.warehouse_id as string | undefined,
    default_catalog: r.default_catalog as string | undefined,
    default_schema: r.default_schema as string | undefined,
    workspace_folder: r.workspace_folder as string | undefined,
    messages: [],
  };
}

function rowToMessage(r: Record<string, unknown>): Message {
  return {
    id: r.id as string,
    conversation_id: r.conversation_id as string,
    role: r.role as Message['role'],
    content: r.content as string,
    timestamp: (r.created_at as Date).toISOString(),
    is_error: (r.is_error as boolean) || false,
  };
}

export async function getConversations(projectId: string, _userEmail: string): Promise<ConversationResponse[]> {
  if (isPostgresConfigured()) {
    try {
      const result = await query(
        'SELECT * FROM conversations WHERE project_id = $1 ORDER BY created_at DESC',
        [projectId]
      );
      return result.rows.map((r) => toSummary(rowToConv(r)));
    } catch (err) {
      logger.warn(`DB query failed, using in-memory: ${err}`);
    }
  }

  return Array.from(memConversations.values())
    .filter((c) => c.project_id === projectId)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .map(toSummary);
}

export async function getConversation(conversationId: string, projectId: string): Promise<ConversationWithMessages | null> {
  if (isPostgresConfigured()) {
    try {
      const convResult = await query(
        'SELECT * FROM conversations WHERE id = $1 AND project_id = $2',
        [conversationId, projectId]
      );
      if (convResult.rows.length === 0) return null;
      const conv = rowToConv(convResult.rows[0]);

      const msgResult = await query(
        'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
        [conversationId]
      );
      conv.messages = msgResult.rows.map(rowToMessage);
      return toFull(conv);
    } catch (err) {
      logger.warn(`DB query failed, using in-memory: ${err}`);
    }
  }

  const conv = memConversations.get(conversationId);
  if (!conv || conv.project_id !== projectId) return null;
  return toFull(conv);
}

export async function createConversation(projectId: string, title = 'New Conversation'): Promise<ConversationWithMessages> {
  const id = uuidv4();
  const createdAt = new Date().toISOString();

  const conv: StoredConversation = {
    id,
    project_id: projectId,
    title,
    created_at: createdAt,
    messages: [],
  };

  if (isPostgresConfigured()) {
    try {
      await query(
        'INSERT INTO conversations (id, project_id, title, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)',
        [id, projectId, title, createdAt]
      );
    } catch (err) {
      logger.warn(`DB insert failed, using in-memory: ${err}`);
      memConversations.set(id, conv);
    }
  } else {
    memConversations.set(id, conv);
  }

  logger.info(`Created conversation ${id} in project ${projectId}`);
  return toFull(conv);
}

export async function updateConversationTitle(conversationId: string, projectId: string, title: string): Promise<boolean> {
  if (isPostgresConfigured()) {
    try {
      const result = await query(
        'UPDATE conversations SET title = $1, updated_at = NOW() WHERE id = $2 AND project_id = $3',
        [title, conversationId, projectId]
      );
      if (result.rowCount && result.rowCount > 0) return true;
    } catch (err) {
      logger.warn(`DB update failed, trying in-memory: ${err}`);
    }
  }

  const conv = memConversations.get(conversationId);
  if (!conv || conv.project_id !== projectId) return false;
  conv.title = title;
  return true;
}

export async function deleteConversation(conversationId: string, projectId: string): Promise<boolean> {
  if (isPostgresConfigured()) {
    try {
      const result = await query(
        'DELETE FROM conversations WHERE id = $1 AND project_id = $2',
        [conversationId, projectId]
      );
      if (result.rowCount && result.rowCount > 0) return true;
    } catch (err) {
      logger.warn(`DB delete failed, trying in-memory: ${err}`);
    }
  }

  const conv = memConversations.get(conversationId);
  if (!conv || conv.project_id !== projectId) return false;
  memConversations.delete(conversationId);
  return true;
}

export async function addMessage(
  conversationId: string,
  role: Message['role'],
  content: string,
  isError = false
): Promise<Message | null> {
  const id = uuidv4();
  const timestamp = new Date().toISOString();

  const msg: Message = {
    id,
    conversation_id: conversationId,
    role,
    content,
    timestamp,
    is_error: isError,
  };

  if (isPostgresConfigured()) {
    try {
      await query(
        'INSERT INTO messages (id, conversation_id, role, content, is_error, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
        [id, conversationId, role, content, isError, timestamp]
      );
      return msg;
    } catch (err) {
      logger.warn(`DB insert failed, using in-memory: ${err}`);
    }
  }

  const conv = memConversations.get(conversationId);
  if (!conv) return null;
  conv.messages.push(msg);
  return msg;
}

export async function updateSessionId(conversationId: string, sessionId: string): Promise<void> {
  if (isPostgresConfigured()) {
    try {
      await query('UPDATE conversations SET session_id = $1 WHERE id = $2', [sessionId, conversationId]);
      return;
    } catch (err) {
      logger.warn(`DB update failed: ${err}`);
    }
  }
  const conv = memConversations.get(conversationId);
  if (conv) conv.session_id = sessionId;
}

export async function updateConversationSettings(
  conversationId: string,
  settings: {
    cluster_id?: string;
    warehouse_id?: string;
    default_catalog?: string;
    default_schema?: string;
    workspace_folder?: string;
  }
): Promise<void> {
  if (isPostgresConfigured()) {
    try {
      const sets: string[] = [];
      const vals: unknown[] = [];
      let idx = 1;
      if (settings.cluster_id) { sets.push(`cluster_id = $${idx++}`); vals.push(settings.cluster_id); }
      if (settings.warehouse_id) { sets.push(`warehouse_id = $${idx++}`); vals.push(settings.warehouse_id); }
      if (settings.default_catalog) { sets.push(`default_catalog = $${idx++}`); vals.push(settings.default_catalog); }
      if (settings.default_schema) { sets.push(`default_schema = $${idx++}`); vals.push(settings.default_schema); }
      if (settings.workspace_folder) { sets.push(`workspace_folder = $${idx++}`); vals.push(settings.workspace_folder); }
      if (sets.length > 0) {
        sets.push(`updated_at = NOW()`);
        vals.push(conversationId);
        await query(`UPDATE conversations SET ${sets.join(', ')} WHERE id = $${idx}`, vals);
      }
      return;
    } catch (err) {
      logger.warn(`DB update failed: ${err}`);
    }
  }

  const conv = memConversations.get(conversationId);
  if (!conv) return;
  if (settings.cluster_id) conv.cluster_id = settings.cluster_id;
  if (settings.warehouse_id) conv.warehouse_id = settings.warehouse_id;
  if (settings.default_catalog) conv.default_catalog = settings.default_catalog;
  if (settings.default_schema) conv.default_schema = settings.default_schema;
  if (settings.workspace_folder) conv.workspace_folder = settings.workspace_folder;
}

export async function deleteConversationsForProject(projectId: string): Promise<void> {
  if (isPostgresConfigured()) {
    try {
      await query('DELETE FROM conversations WHERE project_id = $1', [projectId]);
      return;
    } catch (err) {
      logger.warn(`DB delete failed: ${err}`);
    }
  }

  for (const [id, conv] of memConversations) {
    if (conv.project_id === projectId) {
      memConversations.delete(id);
    }
  }
}
