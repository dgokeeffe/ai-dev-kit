import { Router, Request, Response } from 'express';
import { getCurrentUser } from '../services/user';
import * as projectService from '../services/projects';
import { logger } from '../services/logger';

export const projectsRouter = Router();

projectsRouter.get('/projects', async (req: Request, res: Response) => {
  try {
    const userEmail = getCurrentUser(req);
    const projects = await projectService.getProjects(userEmail);
    res.json(projects);
  } catch (err) {
    logger.error(`Error listing projects: ${err}`);
    res.status(500).json({ detail: String(err) });
  }
});

projectsRouter.get('/projects/:projectId', async (req: Request, res: Response) => {
  try {
    const userEmail = getCurrentUser(req);
    const project = await projectService.getProject(req.params.projectId, userEmail);
    if (!project) {
      return res.status(404).json({ detail: `Project ${req.params.projectId} not found` });
    }
    return res.json(project);
  } catch (err) {
    logger.error(`Error getting project: ${err}`);
    return res.status(500).json({ detail: String(err) });
  }
});

projectsRouter.post('/projects', async (req: Request, res: Response) => {
  try {
    const userEmail = getCurrentUser(req);
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ detail: 'Name is required' });
    }
    const project = await projectService.createProject(name, userEmail);
    return res.status(201).json(project);
  } catch (err) {
    logger.error(`Error creating project: ${err}`);
    return res.status(500).json({ detail: String(err) });
  }
});

projectsRouter.patch('/projects/:projectId', async (req: Request, res: Response) => {
  try {
    const userEmail = getCurrentUser(req);
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ detail: 'Name is required' });
    }
    const success = await projectService.updateProject(req.params.projectId, name, userEmail);
    if (!success) {
      return res.status(404).json({ detail: `Project ${req.params.projectId} not found` });
    }
    return res.json({ success: true, project_id: req.params.projectId });
  } catch (err) {
    logger.error(`Error updating project: ${err}`);
    return res.status(500).json({ detail: String(err) });
  }
});

projectsRouter.delete('/projects/:projectId', async (req: Request, res: Response) => {
  try {
    const userEmail = getCurrentUser(req);
    const success = await projectService.deleteProject(req.params.projectId, userEmail);
    if (!success) {
      return res.status(404).json({ detail: `Project ${req.params.projectId} not found` });
    }
    return res.json({ success: true, deleted_project_id: req.params.projectId });
  } catch (err) {
    logger.error(`Error deleting project: ${err}`);
    return res.status(500).json({ detail: String(err) });
  }
});
