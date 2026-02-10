import type {
  AgentEvent,
  Cluster,
  Conversation,
  DeployLog,
  DeployStatus,
  FileContent,
  FileNode,
  Project,
  Skill,
  Warehouse,
} from './types';

const API_BASE = '/api';

// =============================================================================
// Backend Routing (for dual-app architecture)
// =============================================================================

/**
 * Backend URLs for dual-app deployment.
 * In single-app mode, both point to the same backend (/api).
 * In dual-app mode, these are set via environment variables to point to
 * separate backend instances for load distribution.
 */
const BACKEND_URLS = [
  import.meta.env.VITE_BACKEND_1_URL || '/api',
  import.meta.env.VITE_BACKEND_2_URL || '/api',
];

/**
 * Get the backend URL for a given user email using hash-based routing.
 *
 * Uses consistent hashing to ensure the same user always routes to the same
 * backend, which is important for PTY session affinity (sessions are local
 * to each backend instance).
 *
 * The assignment is cached in localStorage to maintain session affinity
 * even if the routing algorithm changes or backends are reconfigured.
 */
export function getBackendUrl(userEmail: string): string {
  // Check localStorage for existing assignment (session affinity)
  const cached = localStorage.getItem('backend_assignment');
  if (cached) {
    try {
      const { email, url } = JSON.parse(cached);
      // Verify the cached URL is still valid (in our configured backends)
      if (email === userEmail && BACKEND_URLS.includes(url)) {
        return url;
      }
    } catch {
      // Invalid cache, continue to hash-based routing
    }
  }

  // Hash-based routing: sum of character codes mod number of backends
  const hash = userEmail.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const backendIndex = hash % BACKEND_URLS.length;
  const url = BACKEND_URLS[backendIndex];

  // Cache assignment for session affinity
  localStorage.setItem('backend_assignment', JSON.stringify({ email: userEmail, url }));
  return url;
}

/**
 * Clear the cached backend assignment.
 * Call this when the user logs out or needs to be rerouted.
 */
export function clearBackendAssignment(): void {
  localStorage.removeItem('backend_assignment');
}

/**
 * Helper to handle API responses.
 * Gracefully handles both JSON and non-JSON error responses (e.g. HTML tracebacks).
 */
async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const error = await response.json();
      message = error.detail || message;
    } catch {
      const text = await response.text();
      message = text.substring(0, 200) || message;
    }
    throw new Error(message);
  }
  return response.json();
}

// =============================================================================
// Projects API
// =============================================================================

export async function fetchProjects(): Promise<Project[]> {
  const response = await fetch(`${API_BASE}/projects`);
  return handleResponse<Project[]>(response);
}

export async function fetchProject(projectId: string): Promise<Project> {
  const response = await fetch(`${API_BASE}/projects/${projectId}`);
  return handleResponse<Project>(response);
}

export async function createProject(name: string, template?: string): Promise<Project> {
  const response = await fetch(`${API_BASE}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, template }),
  });
  return handleResponse<Project>(response);
}

export async function updateProject(projectId: string, name: string): Promise<void> {
  const response = await fetch(`${API_BASE}/projects/${projectId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  await handleResponse(response);
}

export async function deleteProject(projectId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/projects/${projectId}`, {
    method: 'DELETE',
  });
  await handleResponse(response);
}

// =============================================================================
// Conversations API
// =============================================================================

export async function fetchConversations(projectId: string): Promise<Conversation[]> {
  const response = await fetch(`${API_BASE}/projects/${projectId}/conversations`);
  return handleResponse<Conversation[]>(response);
}

export async function fetchConversation(
  projectId: string,
  conversationId: string
): Promise<Conversation> {
  const response = await fetch(
    `${API_BASE}/projects/${projectId}/conversations/${conversationId}`
  );
  return handleResponse<Conversation>(response);
}

export async function createConversation(projectId: string): Promise<Conversation> {
  const response = await fetch(`${API_BASE}/projects/${projectId}/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  return handleResponse<Conversation>(response);
}

export async function deleteConversation(
  projectId: string,
  conversationId: string
): Promise<void> {
  const response = await fetch(
    `${API_BASE}/projects/${projectId}/conversations/${conversationId}`,
    { method: 'DELETE' }
  );
  await handleResponse(response);
}

// =============================================================================
// Agent API
// =============================================================================

interface InvokeAgentParams {
  projectId: string;
  conversationId?: string;
  message: string;
  clusterId?: string;
  warehouseId?: string;
  defaultCatalog?: string;
  defaultSchema?: string;
  workspaceFolder?: string;
  signal?: AbortSignal;
  onEvent: (event: AgentEvent) => void;
  onError: (error: Error) => void;
  onDone: () => void;
}

export async function invokeAgent({
  projectId,
  conversationId,
  message,
  clusterId,
  warehouseId,
  defaultCatalog,
  defaultSchema,
  workspaceFolder,
  signal,
  onEvent,
  onError,
  onDone,
}: InvokeAgentParams): Promise<void> {
  try {
    // Step 1: Start the agent and get execution_id
    const invokeResponse = await fetch(`${API_BASE}/agent/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: projectId,
        conversation_id: conversationId,
        message,
        cluster_id: clusterId,
        warehouse_id: warehouseId,
        default_catalog: defaultCatalog,
        default_schema: defaultSchema,
        workspace_folder: workspaceFolder,
      }),
      signal,
    });

    if (!invokeResponse.ok) {
      let message = `HTTP ${invokeResponse.status}`;
      try {
        const error = await invokeResponse.json();
        message = error.detail || message;
      } catch {
        const text = await invokeResponse.text();
        message = text.substring(0, 200) || message;
      }
      throw new Error(message);
    }

    const { execution_id } = await invokeResponse.json();

    // Step 2: Stream progress events via SSE
    let lastTimestamp = 0;
    let shouldReconnect = true;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 3;

    while (shouldReconnect) {
      shouldReconnect = false;

      // Notify UI of reconnection (skip first connection)
      if (reconnectAttempts > 0) {
        onEvent({ type: 'system', subtype: 'reconnecting', data: { attempt: reconnectAttempts } });
      }

      const streamResponse = await fetch(`${API_BASE}/agent/stream_progress/${execution_id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ last_event_timestamp: lastTimestamp }),
        signal,
      });

      if (!streamResponse.ok) {
        let errorMsg = `HTTP ${streamResponse.status}`;
        try {
          const error = await streamResponse.json();
          errorMsg = error.detail || errorMsg;
        } catch {
          const text = await streamResponse.text();
          errorMsg = text.substring(0, 200) || errorMsg;
        }
        throw new Error(errorMsg);
      }

      const reader = streamResponse.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            if (line === 'data: [DONE]') {
              continue;
            }
            try {
              const data = JSON.parse(line.slice(6));

              // Handle reconnection signal
              if (data.type === 'stream.reconnect') {
                lastTimestamp = data.last_timestamp || 0;
                reconnectAttempts++;
                if (reconnectAttempts > maxReconnectAttempts) {
                  throw new Error(
                    `Stream reconnection failed after ${maxReconnectAttempts} attempts. ` +
                    'The response may be incomplete.'
                  );
                }
                shouldReconnect = true;
                continue;
              }

              // Handle completion signal
              if (data.type === 'stream.completed') {
                shouldReconnect = false;
                continue;
              }

              onEvent(data);
            } catch (e) {
              // Re-throw reconnection errors
              if (e instanceof Error && e.message.includes('reconnection failed')) {
                throw e;
              }
              // Ignore parse errors for malformed JSON
            }
          }
        }
      }

      // Process any remaining data
      if (buffer.startsWith('data: ') && buffer !== 'data: [DONE]') {
        try {
          const data = JSON.parse(buffer.slice(6));
          if (data.type === 'stream.reconnect') {
            lastTimestamp = data.last_timestamp || 0;
            reconnectAttempts++;
            if (reconnectAttempts > maxReconnectAttempts) {
              throw new Error(
                `Stream reconnection failed after ${maxReconnectAttempts} attempts. ` +
                'The response may be incomplete.'
              );
            }
            shouldReconnect = true;
          } else if (data.type !== 'stream.completed') {
            onEvent(data);
          }
        } catch (e) {
          if (e instanceof Error && e.message.includes('reconnection failed')) {
            throw e;
          }
          // Ignore parse errors
        }
      }
    }

    onDone();
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      onDone();
    } else {
      onError(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

// =============================================================================
// Clusters API
// =============================================================================

export async function fetchClusters(): Promise<Cluster[]> {
  const response = await fetch(`${API_BASE}/clusters`);
  return handleResponse<Cluster[]>(response);
}

// =============================================================================
// Warehouses API
// =============================================================================

export async function fetchWarehouses(): Promise<Warehouse[]> {
  const response = await fetch(`${API_BASE}/warehouses`);
  return handleResponse<Warehouse[]>(response);
}

// =============================================================================
// Files API
// =============================================================================

export async function fetchProjectFiles(projectId: string): Promise<FileNode[]> {
  const response = await fetch(`${API_BASE}/projects/${projectId}/files`);
  return handleResponse<FileNode[]>(response);
}

export async function fetchFileContent(
  projectId: string,
  filePath: string
): Promise<FileContent> {
  const encodedPath = encodeURIComponent(filePath);
  const response = await fetch(`${API_BASE}/projects/${projectId}/files/${encodedPath}`);
  return handleResponse<FileContent>(response);
}

export async function saveFileContent(
  projectId: string,
  filePath: string,
  content: string
): Promise<void> {
  const encodedPath = encodeURIComponent(filePath);
  const response = await fetch(`${API_BASE}/projects/${projectId}/files/${encodedPath}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  await handleResponse(response);
}

export async function deleteFile(projectId: string, filePath: string): Promise<void> {
  const encodedPath = encodeURIComponent(filePath);
  const response = await fetch(`${API_BASE}/projects/${projectId}/files/${encodedPath}`, {
    method: 'DELETE',
  });
  await handleResponse(response);
}

export async function createFile(
  projectId: string,
  filePath: string,
  content: string = ''
): Promise<void> {
  const encodedPath = encodeURIComponent(filePath);
  const response = await fetch(`${API_BASE}/projects/${projectId}/files/${encodedPath}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  await handleResponse(response);
}

export async function createDirectory(
  projectId: string,
  dirPath: string
): Promise<void> {
  const response = await fetch(`${API_BASE}/projects/${projectId}/directories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: dirPath }),
  });
  await handleResponse(response);
}

export async function renameFile(
  projectId: string,
  oldPath: string,
  newPath: string
): Promise<void> {
  const response = await fetch(`${API_BASE}/projects/${projectId}/files/rename`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ old_path: oldPath, new_path: newPath }),
  });
  await handleResponse(response);
}

// =============================================================================
// Deploy API
// =============================================================================

export async function deployProject(projectId: string): Promise<DeployStatus> {
  const response = await fetch(`${API_BASE}/projects/${projectId}/deploy`, {
    method: 'POST',
  });
  return handleResponse<DeployStatus>(response);
}

export async function getDeployStatus(projectId: string): Promise<DeployStatus> {
  const response = await fetch(`${API_BASE}/projects/${projectId}/deploy/status`);
  return handleResponse<DeployStatus>(response);
}

export async function streamDeployLogs(
  projectId: string,
  onLog: (log: DeployLog) => void,
  signal?: AbortSignal
): Promise<void> {
  const response = await fetch(`${API_BASE}/projects/${projectId}/deploy/logs`, {
    signal,
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const log = JSON.parse(line.slice(6)) as DeployLog;
          onLog(log);
        } catch {
          // Ignore parse errors
        }
      }
    }
  }
}

// =============================================================================
// Skills API
// =============================================================================

export async function fetchSkills(projectId: string): Promise<Skill[]> {
  const response = await fetch(`${API_BASE}/projects/${projectId}/skills`);
  return handleResponse<Skill[]>(response);
}

export async function fetchSkillContent(
  projectId: string,
  skillName: string
): Promise<Skill> {
  const response = await fetch(`${API_BASE}/projects/${projectId}/skills/${skillName}`);
  return handleResponse<Skill>(response);
}

// =============================================================================
// User/Config API
// =============================================================================

export interface UserConfig {
  user: string | null;
  workspace_url: string | null;
}

export async function fetchUserConfig(): Promise<UserConfig> {
  const response = await fetch(`${API_BASE}/me`);
  return handleResponse<UserConfig>(response);
}

// =============================================================================
// Extended User Info API (includes Lakebase status)
// =============================================================================

export interface UserInfo {
  user: string | null;
  workspace_url: string | null;
  database_available: boolean;
  lakebase_configured: boolean;
  lakebase_error: string | null;
}

export async function fetchUserInfo(): Promise<UserInfo> {
  const response = await fetch(`${API_BASE}/me`);
  return handleResponse<UserInfo>(response);
}

// =============================================================================
// Skills Tree API
// =============================================================================

export interface SkillTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: SkillTreeNode[];
}

export interface SkillFile {
  path: string;
  content: string;
}

export async function fetchSkillsTree(projectId: string): Promise<SkillTreeNode[]> {
  const response = await fetch(`${API_BASE}/projects/${projectId}/skills/tree`);
  return handleResponse<SkillTreeNode[]>(response);
}

export async function fetchSkillFile(projectId: string, path: string): Promise<SkillFile> {
  const encodedPath = encodeURIComponent(path);
  const response = await fetch(`${API_BASE}/projects/${projectId}/skills/file/${encodedPath}`);
  return handleResponse<SkillFile>(response);
}

export async function reloadProjectSkills(projectId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/projects/${projectId}/skills/reload`, {
    method: 'POST',
  });
  await handleResponse(response);
}

// =============================================================================
// System Prompt API
// =============================================================================

export interface FetchSystemPromptParams {
  clusterId?: string;
  warehouseId?: string;
  defaultCatalog?: string;
  defaultSchema?: string;
  workspaceFolder?: string;
}

export async function fetchSystemPrompt(params: FetchSystemPromptParams): Promise<string> {
  const queryParams = new URLSearchParams();
  if (params.clusterId) queryParams.set('cluster_id', params.clusterId);
  if (params.warehouseId) queryParams.set('warehouse_id', params.warehouseId);
  if (params.defaultCatalog) queryParams.set('default_catalog', params.defaultCatalog);
  if (params.defaultSchema) queryParams.set('default_schema', params.defaultSchema);
  if (params.workspaceFolder) queryParams.set('workspace_folder', params.workspaceFolder);

  const response = await fetch(`${API_BASE}/system_prompt?${queryParams.toString()}`);
  const data = await handleResponse<{ system_prompt: string }>(response);
  return data.system_prompt;
}

// =============================================================================
// Search API
// =============================================================================

export interface SearchResult {
  path: string;
  line_number: number;
  line_content: string;
  match_start: number;
  match_end: number;
}

export interface SearchParams {
  query: string;
  caseSensitive?: boolean;
  regex?: boolean;
  glob?: string;
}

export async function searchFiles(
  projectId: string,
  params: SearchParams
): Promise<SearchResult[]> {
  const queryParams = new URLSearchParams();
  queryParams.set('query', params.query);
  if (params.caseSensitive) queryParams.set('case_sensitive', 'true');
  if (params.regex) queryParams.set('regex', 'true');
  if (params.glob) queryParams.set('glob', params.glob);

  const response = await fetch(
    `${API_BASE}/projects/${projectId}/files/search?${queryParams.toString()}`
  );
  return handleResponse<SearchResult[]>(response);
}

// =============================================================================
// Terminal API
// =============================================================================

export interface TerminalOutput {
  stdout: string;
  stderr: string;
  exit_code: number;
}

export async function executeTerminalCommand(
  projectId: string,
  command: string
): Promise<TerminalOutput> {
  const response = await fetch(`${API_BASE}/projects/${projectId}/terminal/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command }),
  });
  return handleResponse<TerminalOutput>(response);
}

// =============================================================================
// PTY API (with backend routing for dual-app deployment)
// =============================================================================

export interface PtySession {
  session_id: string;
  status: string;
}

export interface PtyOutput {
  output: string;
  exited?: boolean;
  files_modified_at?: number;
}

/**
 * Get the PTY backend URL for the current user.
 *
 * This is used by the ClaudeTerminal component to route PTY requests to the
 * correct backend instance based on the user's email hash.
 *
 * @param userEmail - The current user's email (used for hash-based routing)
 * @returns The base URL for PTY API calls
 */
export function getPtyBackendUrl(userEmail: string): string {
  return getBackendUrl(userEmail);
}

/**
 * Create a new PTY session.
 * Routes to the appropriate backend based on user email hash.
 */
export async function createPtySession(
  projectId: string,
  userEmail: string
): Promise<PtySession> {
  const backendUrl = getBackendUrl(userEmail);
  const response = await fetch(`${backendUrl}/projects/${projectId}/pty/create`, {
    method: 'POST',
  });
  return handleResponse<PtySession>(response);
}

/**
 * Poll PTY output.
 * Routes to the appropriate backend based on user email hash.
 */
export async function pollPtyOutput(
  projectId: string,
  sessionId: string,
  userEmail: string,
  timeout: number = 0
): Promise<PtyOutput> {
  const backendUrl = getBackendUrl(userEmail);
  const response = await fetch(
    `${backendUrl}/projects/${projectId}/pty/${sessionId}/output?timeout=${timeout}`,
    { method: 'POST' }
  );
  return handleResponse<PtyOutput>(response);
}

/**
 * Send input to PTY.
 * Routes to the appropriate backend based on user email hash.
 */
export async function sendPtyInput(
  projectId: string,
  sessionId: string,
  userEmail: string,
  data: string
): Promise<void> {
  const backendUrl = getBackendUrl(userEmail);
  const response = await fetch(
    `${backendUrl}/projects/${projectId}/pty/${sessionId}/input`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data }),
    }
  );
  await handleResponse(response);
}

/**
 * Resize PTY terminal.
 * Routes to the appropriate backend based on user email hash.
 */
export async function resizePty(
  projectId: string,
  sessionId: string,
  userEmail: string,
  cols: number,
  rows: number
): Promise<void> {
  const backendUrl = getBackendUrl(userEmail);
  const response = await fetch(
    `${backendUrl}/projects/${projectId}/pty/${sessionId}/resize`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cols, rows }),
    }
  );
  await handleResponse(response);
}

/**
 * Delete PTY session.
 * Routes to the appropriate backend based on user email hash.
 */
export async function deletePtySession(
  projectId: string,
  sessionId: string,
  userEmail: string
): Promise<void> {
  const backendUrl = getBackendUrl(userEmail);
  const response = await fetch(
    `${backendUrl}/projects/${projectId}/pty/${sessionId}`,
    { method: 'DELETE' }
  );
  await handleResponse(response);
}

/**
 * Terminate PTY session (via sendBeacon for page unload).
 * Returns the URL to use with navigator.sendBeacon().
 */
export function getPtyTerminateUrl(
  projectId: string,
  sessionId: string,
  userEmail: string
): string {
  const backendUrl = getBackendUrl(userEmail);
  return `${backendUrl}/projects/${projectId}/pty/${sessionId}/terminate`;
}

// =============================================================================
// Health API
// =============================================================================

export interface HealthStatus {
  status: string;
  app_instance: string;
  active_pty_sessions: number;
}

/**
 * Check health of a specific backend instance.
 */
export async function checkBackendHealth(backendUrl: string): Promise<HealthStatus> {
  const response = await fetch(`${backendUrl}/health`);
  return handleResponse<HealthStatus>(response);
}
