import { Router, Request, Response } from 'express';
import { getCurrentUser } from '../services/user';
import * as convService from '../services/conversations';
import { logger } from '../services/logger';

export const conversationsRouter = Router();

conversationsRouter.get('/projects/:projectId/conversations', async (req: Request, res: Response) => {
  try {
    const userEmail = getCurrentUser(req);
    const conversations = await convService.getConversations(req.params.projectId, userEmail);
    res.json(conversations);
  } catch (err) {
    logger.error(`Error listing conversations: ${err}`);
    res.status(500).json({ detail: String(err) });
  }
});

conversationsRouter.get('/projects/:projectId/conversations/:conversationId', async (req: Request, res: Response) => {
  try {
    const conv = await convService.getConversation(req.params.conversationId, req.params.projectId);
    if (!conv) {
      return res.status(404).json({ detail: `Conversation ${req.params.conversationId} not found` });
    }
    return res.json(conv);
  } catch (err) {
    logger.error(`Error getting conversation: ${err}`);
    return res.status(500).json({ detail: String(err) });
  }
});

conversationsRouter.post('/projects/:projectId/conversations', async (req: Request, res: Response) => {
  try {
    const title = req.body.title || 'New Conversation';
    const conv = await convService.createConversation(req.params.projectId, title);
    res.status(201).json(conv);
  } catch (err) {
    logger.error(`Error creating conversation: ${err}`);
    res.status(500).json({ detail: String(err) });
  }
});

conversationsRouter.patch('/projects/:projectId/conversations/:conversationId', async (req: Request, res: Response) => {
  try {
    const { title } = req.body;
    if (!title) {
      return res.status(400).json({ detail: 'Title is required' });
    }
    const success = await convService.updateConversationTitle(
      req.params.conversationId,
      req.params.projectId,
      title,
    );
    if (!success) {
      return res.status(404).json({ detail: `Conversation ${req.params.conversationId} not found` });
    }
    return res.json({ success: true, conversation_id: req.params.conversationId });
  } catch (err) {
    logger.error(`Error updating conversation: ${err}`);
    return res.status(500).json({ detail: String(err) });
  }
});

conversationsRouter.delete('/projects/:projectId/conversations/:conversationId', async (req: Request, res: Response) => {
  try {
    const success = await convService.deleteConversation(
      req.params.conversationId,
      req.params.projectId,
    );
    if (!success) {
      return res.status(404).json({ detail: `Conversation ${req.params.conversationId} not found` });
    }
    return res.json({ success: true, deleted_conversation_id: req.params.conversationId });
  } catch (err) {
    logger.error(`Error deleting conversation: ${err}`);
    return res.status(500).json({ detail: String(err) });
  }
});
