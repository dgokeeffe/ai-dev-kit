import { Router, Request, Response } from 'express';
import { execFile } from 'child_process';
import path from 'path';
import { ensureProjectDirectory } from '../services/projects';
import { logger } from '../services/logger';

export const terminalRouter = Router();

const MAX_EXECUTION_TIME = 30000; // 30 seconds

const ALLOWED_COMMANDS = new Set([
  'ls', 'cat', 'head', 'tail', 'grep', 'find', 'wc', 'sort', 'uniq',
  'echo', 'pwd', 'date', 'whoami', 'env', 'printenv',
  'python', 'python3', 'pip', 'pip3',
  'node', 'npm', 'npx',
  'git',
  'curl', 'wget',
  'mkdir', 'touch', 'cp', 'mv', 'rm',
  'tar', 'zip', 'unzip', 'gzip', 'gunzip',
  'which', 'type', 'file',
  'diff', 'patch',
  'ruff', 'black', 'mypy', 'pylint', 'pytest',
  'eslint', 'prettier', 'tsc',
]);

function parseCommand(command: string): { executable: string; args: string[] } {
  // Simple shell-like argument parsing (no shell expansion)
  const parts: string[] = [];
  let current = '';
  let inQuote = '';

  for (const char of command) {
    if (inQuote) {
      if (char === inQuote) {
        inQuote = '';
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      inQuote = char;
    } else if (char === ' ' || char === '\t') {
      if (current) {
        parts.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }
  if (current) parts.push(current);

  if (parts.length === 0) {
    throw new Error('Empty command');
  }

  return { executable: parts[0], args: parts.slice(1) };
}

// POST /api/projects/:projectId/terminal/execute
terminalRouter.post('/projects/:projectId/terminal/execute', (req: Request, res: Response) => {
  try {
    const projectDir = ensureProjectDirectory(req.params.projectId);
    const { command } = req.body;

    if (!command || !command.trim()) {
      return res.status(400).json({ detail: 'Empty command' });
    }

    const { executable, args } = parseCommand(command.trim());

    // Reject any path separators - force PATH resolution to prevent whitelist bypass
    if (executable.includes('/') || executable.includes('\\')) {
      return res.status(403).json({
        detail: `Command not allowed: absolute or relative paths not permitted. Use command name only (e.g., 'python3' not '/usr/bin/python3')`,
      });
    }

    if (!ALLOWED_COMMANDS.has(executable)) {
      return res.status(403).json({
        detail: `Command "${executable}" is not allowed. Allowed: ${Array.from(ALLOWED_COMMANDS).sort().join(', ')}`,
      });
    }

    const env = {
      ...process.env,
      HOME: process.env.HOME || '/tmp',
      PATH: process.env.PATH || '/usr/bin:/bin',
    };

    execFile(executable, args, {
      cwd: projectDir,
      timeout: MAX_EXECUTION_TIME,
      env,
      maxBuffer: 1024 * 1024, // 1MB
    }, (error, stdout, stderr) => {
      if (error && (error as any).killed) {
        return res.status(408).json({
          detail: `Command timed out after ${MAX_EXECUTION_TIME / 1000} seconds`,
        });
      }

      return res.json({
        stdout: stdout || '',
        stderr: stderr || '',
        exit_code: error ? (error as any).code || 1 : 0,
      });
    });

    return; // Response sent in callback
  } catch (err) {
    logger.error(`Error executing command: ${err}`);
    return res.status(500).json({ detail: String(err) });
  }
});
