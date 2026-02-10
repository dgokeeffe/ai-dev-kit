import { Router, Request, Response } from 'express';
import { getUserCredentials, getWorkspaceUrl } from '../services/user';
import { logger } from '../services/logger';

export const infrastructureRouter = Router();

// GET /api/clusters - list Databricks clusters
infrastructureRouter.get('/clusters', async (req: Request, res: Response) => {
  try {
    const { host, token } = getUserCredentials(req);
    if (!host || !token) {
      return res.json([]);
    }

    const url = `${host.replace(/\/+$/, '')}/api/2.0/clusters/list`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      logger.warn(`Failed to list clusters: ${response.status}`);
      return res.json([]);
    }

    const data = await response.json() as { clusters?: Array<Record<string, unknown>> };
    const clusters = (data.clusters || []).map((c: Record<string, unknown>) => ({
      cluster_id: c.cluster_id,
      cluster_name: c.cluster_name,
      state: c.state || 'UNKNOWN',
      spark_version: c.spark_version,
      node_type_id: c.node_type_id,
    }));

    return res.json(clusters);
  } catch (err) {
    logger.error(`Error listing clusters: ${err}`);
    return res.json([]);
  }
});

// GET /api/warehouses - list SQL warehouses
infrastructureRouter.get('/warehouses', async (req: Request, res: Response) => {
  try {
    const { host, token } = getUserCredentials(req);
    if (!host || !token) {
      return res.json([]);
    }

    const url = `${host.replace(/\/+$/, '')}/api/2.0/sql/warehouses`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      logger.warn(`Failed to list warehouses: ${response.status}`);
      return res.json([]);
    }

    const data = await response.json() as { warehouses?: Array<Record<string, unknown>> };
    const warehouses = (data.warehouses || []).map((w: Record<string, unknown>) => ({
      warehouse_id: w.id,
      warehouse_name: w.name,
      state: w.state || 'UNKNOWN',
      cluster_size: w.cluster_size,
      warehouse_type: w.warehouse_type,
    }));

    return res.json(warehouses);
  } catch (err) {
    logger.error(`Error listing warehouses: ${err}`);
    return res.json([]);
  }
});
