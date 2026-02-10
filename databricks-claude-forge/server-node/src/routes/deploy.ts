import { Router, Request, Response } from 'express';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getCurrentUser, getUserCredentials } from '../services/user';
import { ensureProjectDirectory } from '../services/projects';
import { logger } from '../services/logger';

export const deployRouter = Router();

interface DeployStatus {
  status: 'idle' | 'deploying' | 'success' | 'error';
  app_url: string | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  logs: Array<{ timestamp: string; level: string; message: string }>;
}

const deployStatus: Map<string, DeployStatus> = new Map();

function getStatus(projectId: string): DeployStatus {
  return deployStatus.get(projectId) || {
    status: 'idle',
    app_url: null,
    error: null,
    started_at: null,
    completed_at: null,
    logs: [],
  };
}

function addLog(projectId: string, level: string, message: string): void {
  const status = deployStatus.get(projectId);
  if (!status) return;
  status.logs.push({ timestamp: new Date().toISOString(), level, message });
  if (status.logs.length > 500) {
    status.logs = status.logs.slice(-500);
  }
}

// POST /api/projects/:projectId/deploy
deployRouter.post('/projects/:projectId/deploy', async (req: Request, res: Response) => {
  try {
    const projectDir = ensureProjectDirectory(req.params.projectId);
    const { host, token } = getUserCredentials(req);

    // Check for deployment config
    const appYaml = path.join(projectDir, 'app.yaml');
    const databricksYml = path.join(projectDir, 'databricks.yml');
    const hasConfig = fs.existsSync(appYaml) || fs.existsSync(databricksYml);

    if (!hasConfig) {
      return res.status(400).json({
        detail: 'No app.yaml or databricks.yml found. Create a deployment config first.',
      });
    }

    const current = getStatus(req.params.projectId);
    if (current.status === 'deploying') {
      return res.status(409).json({ detail: 'Deployment already in progress' });
    }

    if (!host || !token) {
      return res.status(401).json({ detail: 'Databricks credentials not available' });
    }

    const status: DeployStatus = {
      status: 'deploying',
      app_url: null,
      error: null,
      started_at: new Date().toISOString(),
      completed_at: null,
      logs: [],
    };
    deployStatus.set(req.params.projectId, status);

    // Run deployment in background
    const target = req.body?.target || 'dev';
    const cmd = 'databricks';
    const args = ['bundle', 'deploy', '--target', target];

    const env = { ...process.env, DATABRICKS_HOST: host, DATABRICKS_TOKEN: token };
    const child = spawn(cmd, args, { cwd: projectDir, env });

    child.stdout.on('data', (data: Buffer) => {
      const text = data.toString().trim();
      if (text) {
        addLog(req.params.projectId, 'info', text);
      }
    });

    child.stderr.on('data', (data: Buffer) => {
      const text = data.toString().trim();
      if (text) {
        const level = text.toLowerCase().includes('error') ? 'error' : 'info';
        addLog(req.params.projectId, level, text);
      }
    });

    child.on('close', (code) => {
      const s = deployStatus.get(req.params.projectId);
      if (!s) return;
      s.completed_at = new Date().toISOString();
      if (code === 0) {
        s.status = 'success';
        addLog(req.params.projectId, 'info', 'Deployment completed successfully');
        // Try to extract app URL from logs
        for (const log of s.logs) {
          const urlMatch = log.message.match(/https:\/\/[^\s]+\.apps\.[^\s]+/);
          if (urlMatch) {
            s.app_url = urlMatch[0];
            break;
          }
        }
      } else {
        s.status = 'error';
        s.error = `Deployment failed with exit code ${code}`;
        addLog(req.params.projectId, 'error', s.error);
      }
    });

    child.on('error', (err) => {
      const s = deployStatus.get(req.params.projectId);
      if (!s) return;
      s.status = 'error';
      s.error = `Failed to start deploy: ${err.message}`;
      s.completed_at = new Date().toISOString();
    });

    return res.json({ status: 'deploying', message: `Deployment started for target: ${target}` });
  } catch (err) {
    logger.error(`Error deploying project: ${err}`);
    return res.status(500).json({ detail: String(err) });
  }
});

// GET /api/projects/:projectId/deploy/status
deployRouter.get('/projects/:projectId/deploy/status', (req: Request, res: Response) => {
  const status = getStatus(req.params.projectId);
  res.json({
    status: status.status,
    app_url: status.app_url,
    error: status.error,
    started_at: status.started_at,
    completed_at: status.completed_at,
  });
});

// GET /api/projects/:projectId/deploy/logs - SSE stream
deployRouter.get('/projects/:projectId/deploy/logs', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const projectId = req.params.projectId;
  let sentCount = 0;

  const interval = setInterval(() => {
    const status = getStatus(projectId);
    const logs = status.logs;

    // Send new logs
    for (let i = sentCount; i < logs.length; i++) {
      res.write(`data: ${JSON.stringify(logs[i])}\n\n`);
    }
    sentCount = logs.length;

    // If done, send final status and close
    if (status.status !== 'deploying') {
      res.write(`data: ${JSON.stringify({
        type: 'status',
        status: status.status,
        app_url: status.app_url,
      })}\n\n`);
      clearInterval(interval);
      res.end();
    }
  }, 500);

  req.on('close', () => {
    clearInterval(interval);
  });
});
