import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getCurrentUser, getCurrentToken, getWorkspaceUrl } from '../services/user';
import * as convService from '../services/conversations';
import { getProjectDirectory } from '../services/projects';
import { logger } from '../services/logger';

export const agentRouter = Router();

// In-memory execution store
interface ExecutionStream {
  executionId: string;
  conversationId: string;
  projectId: string;
  events: Array<{ data: Record<string, unknown>; timestamp: number }>;
  isComplete: boolean;
  isCancelled: boolean;
  error: string | null;
}

const streams: Map<string, ExecutionStream> = new Map();

function sseEvent(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

// POST /api/agent/invoke - start agent execution
agentRouter.post('/agent/invoke', async (req: Request, res: Response) => {
  try {
    const userEmail = getCurrentUser(req);
    const {
      project_id: projectId,
      conversation_id: conversationId,
      message,
      cluster_id: clusterId,
      warehouse_id: warehouseId,
      default_catalog: defaultCatalog,
      default_schema: defaultSchema,
      workspace_folder: workspaceFolder,
    } = req.body;

    if (!projectId || !message) {
      return res.status(400).json({ detail: 'project_id and message are required' });
    }

    // Get or create conversation
    let convId = conversationId;
    if (!convId) {
      const tempTitle = message.substring(0, 40).trim() + (message.length > 40 ? '...' : '');
      const conv = await convService.createConversation(projectId, tempTitle);
      convId = conv.id;
    } else {
      const existing = await convService.getConversation(convId, projectId);
      if (!existing) {
        return res.status(404).json({ detail: `Conversation ${convId} not found` });
      }
    }

    const executionId = uuidv4();

    // Create stream
    const stream: ExecutionStream = {
      executionId,
      conversationId: convId,
      projectId,
      events: [],
      isComplete: false,
      isCancelled: false,
      error: null,
    };
    streams.set(executionId, stream);

    // Add conversation created event
    stream.events.push({
      data: { type: 'conversation.created', conversation_id: convId },
      timestamp: Date.now(),
    });

    // Save user message
    await convService.addMessage(convId, 'user', message);

    // Update conversation settings
    if (clusterId || warehouseId || defaultCatalog || defaultSchema || workspaceFolder) {
      await convService.updateConversationSettings(convId, {
        cluster_id: clusterId,
        warehouse_id: warehouseId,
        default_catalog: defaultCatalog,
        default_schema: defaultSchema,
        workspace_folder: workspaceFolder,
      });
    }

    // Start agent in background (placeholder - agent execution happens in terminal via PTY)
    const capturedConvId = convId;
    setTimeout(async () => {
      stream.events.push({
        data: {
          type: 'text',
          text: 'Agent invocation is handled through the Claude Code terminal. Use the terminal panel to interact with Claude.',
        },
        timestamp: Date.now(),
      });

      await convService.addMessage(
        capturedConvId,
        'assistant',
        'Agent invocation is handled through the Claude Code terminal. Use the terminal panel to interact with Claude.',
      );

      stream.isComplete = true;
      stream.events.push({
        data: { type: 'stream.completed', is_error: false, is_cancelled: false },
        timestamp: Date.now(),
      });
    }, 100);

    return res.json({ execution_id: executionId, conversation_id: convId });
  } catch (err) {
    logger.error(`Error invoking agent: ${err}`);
    return res.status(500).json({ detail: String(err) });
  }
});

// POST /api/agent/stream_progress/:executionId - SSE stream
agentRouter.post('/agent/stream_progress/:executionId', (req: Request, res: Response) => {
  const { executionId } = req.params;
  const stream = streams.get(executionId);

  if (!stream) {
    return res.status(404).json({ detail: `Stream not found: ${executionId}` });
  }

  const lastTimestamp = req.body.last_event_timestamp || 0;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const SSE_WINDOW_MS = 50000;
  const startTime = Date.now();
  let lastSentTimestamp = lastTimestamp;

  const interval = setInterval(() => {
    // Send new events
    const newEvents = stream.events.filter((e) => e.timestamp > lastSentTimestamp);
    for (const event of newEvents) {
      res.write(sseEvent(event.data));
      lastSentTimestamp = event.timestamp;
    }

    // Check completion
    if (stream.isComplete || stream.isCancelled) {
      res.write(sseEvent({
        type: 'stream.completed',
        is_error: stream.error !== null,
        is_cancelled: stream.isCancelled,
      }));
      res.write('data: [DONE]\n\n');
      clearInterval(interval);
      res.end();
      return;
    }

    // Check SSE window timeout
    if (Date.now() - startTime > SSE_WINDOW_MS) {
      const lastTs = stream.events.length > 0
        ? stream.events[stream.events.length - 1].timestamp
        : 0;
      res.write(sseEvent({
        type: 'stream.reconnect',
        execution_id: executionId,
        last_timestamp: lastTs,
        message: 'Reconnect to continue streaming',
      }));
      clearInterval(interval);
      res.end();
    }
  }, 100);

  // Clean up on client disconnect
  req.on('close', () => {
    clearInterval(interval);
  });

  return;
});

// POST /api/agent/stop_stream/:executionId - stop streaming
agentRouter.post('/agent/stop_stream/:executionId', (req: Request, res: Response) => {
  const { executionId } = req.params;
  const stream = streams.get(executionId);

  if (!stream) {
    return res.status(404).json({ detail: `Stream not found: ${executionId}` });
  }

  if (stream.isComplete) {
    return res.json({ success: false, message: 'Stream already complete' });
  }

  stream.isCancelled = true;
  return res.json({ success: true, message: 'Stream cancelled' });
});
