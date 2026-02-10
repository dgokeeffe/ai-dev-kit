import { Router, Request, Response } from 'express';
import { getCurrentUser, getWorkspaceUrl } from '../services/user';
import { isPostgresConfigured, testConnection } from '../db/database';
import { logger } from '../services/logger';

export const configRouter = Router();

configRouter.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

configRouter.get('/me', async (req: Request, res: Response) => {
  try {
    const user = getCurrentUser(req);
    const workspaceUrl = getWorkspaceUrl(req.headers['x-forwarded-host'] as string | undefined);

    let lakebaseConfigured = false;
    let lakebaseError: string | null = null;

    if (isPostgresConfigured()) {
      lakebaseConfigured = true;
      const err = await testConnection();
      if (err) {
        lakebaseError = err;
      }
    }

    res.json({
      user,
      workspace_url: workspaceUrl || null,
      lakebase_configured: lakebaseConfigured,
      lakebase_error: lakebaseError,
    });
  } catch (err) {
    logger.error(`Error in /me: ${err}`);
    res.status(500).json({ detail: `Authentication error: ${err}` });
  }
});

configRouter.get('/system_prompt', (req: Request, res: Response) => {
  const clusterId = req.query.cluster_id as string | undefined;
  const warehouseId = req.query.warehouse_id as string | undefined;
  const defaultCatalog = req.query.default_catalog as string | undefined;
  const defaultSchema = req.query.default_schema as string | undefined;
  const workspaceFolder = req.query.workspace_folder as string | undefined;
  const workspaceUrl = getWorkspaceUrl();

  let prompt = `# Databricks AI Dev Kit\n\n`;
  prompt += `You are a Databricks development assistant with access to MCP tools.\n\n`;

  if (clusterId) {
    prompt += `## Selected Cluster\n- **Cluster ID:** \`${clusterId}\`\n\n`;
  }
  if (warehouseId) {
    prompt += `## Selected SQL Warehouse\n- **Warehouse ID:** \`${warehouseId}\`\n\n`;
  }
  if (workspaceFolder) {
    prompt += `## Workspace Folder\n- **Path:** \`${workspaceFolder}\`\n\n`;
  }
  if (defaultCatalog || defaultSchema) {
    prompt += `## Default Unity Catalog Context\n`;
    if (defaultCatalog) prompt += `- **Catalog:** \`${defaultCatalog}\`\n`;
    if (defaultSchema) prompt += `- **Schema:** \`${defaultSchema}\`\n`;
    prompt += '\n';
  }
  if (workspaceUrl) {
    prompt += `## Workspace URL\n\`${workspaceUrl}\`\n\n`;
  }

  res.json({ system_prompt: prompt });
});
