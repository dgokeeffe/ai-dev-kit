import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import * as pty from 'node-pty';
import { URL } from 'url';
import path from 'path';
import fs from 'fs';
import { logger } from './logger';
import { getProjectDirectory, ensureProjectDirectory } from './projects';

interface TerminalSession {
  ptyProcess: pty.IPty;
  ws: WebSocket;
  projectId: string;
}

const sessions: Map<WebSocket, TerminalSession> = new Map();

function getClaudeBin(): string {
  const candidates = [
    '/app/python/source_code/node_modules/.bin/claude', // Databricks Apps
    path.resolve('./node_modules/.bin/claude'),          // Local with package.json
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  // Global fallback
  return 'claude';
}

function buildClaudeEnv(host: string | null, token: string | null, projectDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };

  if (host && token) {
    env.ANTHROPIC_AUTH_TOKEN = token;
    env.ANTHROPIC_BASE_URL = `${host.replace(/\/+$/, '')}/serving-endpoints/anthropic`;
    env.ANTHROPIC_MODEL = 'databricks-claude-sonnet-4-5';
    env.ANTHROPIC_CUSTOM_HEADERS = 'x-databricks-disable-beta-headers: true';
    env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = '1';
  } else if (host) {
    env.ANTHROPIC_BASE_URL = `${host.replace(/\/+$/, '')}/serving-endpoints/anthropic`;
    env.ANTHROPIC_MODEL = 'databricks-claude-sonnet-4-5';
    env.ANTHROPIC_CUSTOM_HEADERS = 'x-databricks-disable-beta-headers: true';
    env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = '1';
  }

  env.PWD = projectDir;
  env.TERM = 'xterm-256color';

  return env;
}

export function initWebSocket(server: http.Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '', `http://${request.headers.host}`);

    // Match both /api/terminal?projectId=xxx AND /api/projects/:id/claude-terminal
    let projectId: string | null = null;

    if (url.pathname === '/api/terminal') {
      projectId = url.searchParams.get('projectId');
    } else {
      const match = url.pathname.match(/^\/api\/projects\/([^/]+)\/claude-terminal$/);
      if (match) {
        projectId = match[1];
      }
    }

    if (!projectId) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request, projectId);
    });
  });

  wss.on('connection', (ws: WebSocket, request: http.IncomingMessage, projectId: string) => {
    logger.info(`Claude terminal WebSocket connected for project ${projectId}`);

    // Verify project directory exists
    const projectDir = ensureProjectDirectory(projectId);

    // Get credentials from headers or env
    const isDev = (process.env.ENV || 'development') === 'development';
    let host: string | null = null;
    let token: string | null = null;

    const forwardedToken = request.headers['x-forwarded-access-token'] as string | undefined;
    const forwardedHost = request.headers['x-forwarded-host'] as string | undefined;

    if (forwardedHost && forwardedToken) {
      host = forwardedHost.startsWith('http') ? forwardedHost : `https://${forwardedHost}`;
      token = forwardedToken;
    }

    if (!host) {
      host = process.env.DATABRICKS_WORKSPACE_URL || process.env.DATABRICKS_HOST || null;
    }
    if (!token && isDev) {
      token = process.env.DATABRICKS_TOKEN || null;
    }

    if (!host) {
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Databricks host not configured. Please set DATABRICKS_HOST.',
      }));
      ws.close(4001);
      return;
    }

    if (!isDev && !token) {
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Databricks credentials not available. Please ensure you are authenticated.',
      }));
      ws.close(4001);
      return;
    }

    // Build environment and spawn PTY
    const env = buildClaudeEnv(host, token, projectDir);
    const claudeBin = getClaudeBin();

    logger.info(`Spawning Claude terminal: ${claudeBin} in ${projectDir}`);

    let ptyProcess: pty.IPty;
    try {
      ptyProcess = pty.spawn(claudeBin, ['--dangerously-skip-permissions'], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: projectDir,
        env: env as Record<string, string>,
      });
    } catch (err) {
      logger.error(`Failed to spawn Claude CLI: ${err}`);
      ws.send(JSON.stringify({ type: 'error', message: `Failed to start Claude: ${err}` }));
      ws.close(4001);
      return;
    }

    sessions.set(ws, { ptyProcess, ws, projectId });

    // Send connected message
    ws.send(JSON.stringify({ type: 'connected', project_dir: projectDir }));

    // PTY -> WebSocket (binary data)
    ptyProcess.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(Buffer.from(data, 'utf-8'));
      }
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
      logger.info(`Claude terminal exited: code=${exitCode}, signal=${signal}`);
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
      sessions.delete(ws);
    });

    // WebSocket -> PTY
    ws.on('message', (data: Buffer | string) => {
      if (Buffer.isBuffer(data)) {
        // Binary terminal input
        const str = data.toString('utf-8');
        ptyProcess.write(str);
      } else if (typeof data === 'string') {
        // JSON control message
        try {
          const msg = JSON.parse(data);
          if (msg.type === 'resize' && msg.cols && msg.rows) {
            ptyProcess.resize(msg.cols, msg.rows);
            logger.debug(`Resized terminal to ${msg.cols}x${msg.rows}`);
          }
        } catch {
          // Not JSON, treat as terminal input
          ptyProcess.write(data);
        }
      }
    });

    ws.on('close', () => {
      logger.info(`Claude terminal WebSocket disconnected for project ${projectId}`);
      const session = sessions.get(ws);
      if (session) {
        session.ptyProcess.kill();
        sessions.delete(ws);
      }
    });

    ws.on('error', (err) => {
      logger.error(`WebSocket error: ${err.message}`);
      const session = sessions.get(ws);
      if (session) {
        session.ptyProcess.kill();
        sessions.delete(ws);
      }
    });
  });
}
