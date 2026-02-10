import path from 'path';
import dotenv from 'dotenv';

// Load .env.local before anything else
const envResult = dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });
const isDev = envResult.parsed ? true : process.env.ENV !== 'production';
if (!isDev) {
  process.env.ENV = 'production';
}

import express from 'express';
import cors from 'cors';
import http from 'http';
import { initWebSocket } from './services/terminal';
import { initDatabase } from './db/database';
import { projectsRouter } from './routes/projects';
import { filesRouter } from './routes/files';
import { conversationsRouter } from './routes/conversations';
import { agentRouter } from './routes/agent';
import { skillsRouter } from './routes/skills';
import { deployRouter } from './routes/deploy';
import { terminalRouter } from './routes/terminal';
import { infrastructureRouter } from './routes/infrastructure';
import { configRouter } from './routes/config';
import { logger } from './services/logger';

const app = express();
const PORT = parseInt(process.env.DATABRICKS_APP_PORT || process.env.PORT || '8000', 10);

// Middleware
app.use(express.json({ limit: '50mb' }));

// CORS for development
if (isDev) {
  app.use(cors({
    origin: ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:5173'],
    credentials: true,
  }));
  logger.info('CORS enabled for development origins');
}

// API routes
app.use('/api', configRouter);
app.use('/api', projectsRouter);
app.use('/api', filesRouter);
app.use('/api', conversationsRouter);
app.use('/api', agentRouter);
app.use('/api', skillsRouter);
app.use('/api', deployRouter);
app.use('/api', terminalRouter);
app.use('/api', infrastructureRouter);

// SPA fallback - serve static frontend build
const clientBuildPaths = [
  path.resolve(__dirname, '../../client/out'),
  path.resolve(__dirname, '../../client'),
];

let staticPath: string | null = null;
for (const p of clientBuildPaths) {
  try {
    const fs = require('fs');
    if (fs.existsSync(path.join(p, 'index.html'))) {
      staticPath = p;
      break;
    }
  } catch {
    // ignore
  }
}

if (staticPath) {
  logger.info(`Serving static files from ${staticPath}`);
  app.use(express.static(staticPath));

  // SPA fallback - must be after API routes
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ detail: `API route not found: ${req.path}` });
    }
    return res.sendFile(path.join(staticPath!, 'index.html'));
  });
} else {
  logger.warn('No client build found. Run: cd client && npm run build');
}

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error(`Unhandled error: ${err.message}`, { stack: err.stack });
  res.status(500).json({ detail: 'Internal Server Error', error: err.message });
});

// Create HTTP server (needed for WebSocket upgrade)
const server = http.createServer(app);

// Initialize WebSocket for Claude terminal
initWebSocket(server);

// Initialize database and start server
async function start() {
  // Initialize database if configured
  try {
    await initDatabase();
  } catch (err) {
    logger.warn(`Database not configured or failed to connect: ${err}. Running without persistence.`);
  }

  server.listen(PORT, '0.0.0.0', () => {
    logger.info(`Server running on http://0.0.0.0:${PORT} (ENV=${process.env.ENV || 'development'})`);
  });
}

start().catch((err) => {
  logger.error(`Failed to start server: ${err}`);
  process.exit(1);
});
