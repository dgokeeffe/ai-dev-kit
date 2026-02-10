import { Request } from 'express';
import { logger } from './logger';

let devUserCache: string | null = null;
let workspaceUrlCache: string | null = null;

function isLocalDevelopment(): boolean {
  return (process.env.ENV || 'development') === 'development';
}

export function getCurrentUser(req: Request): string {
  // Production: X-Forwarded-User header
  const user = req.headers['x-forwarded-user'] as string | undefined;
  if (user) return user;

  // Development fallback
  if (isLocalDevelopment()) {
    if (devUserCache) return devUserCache;

    // No Databricks SDK in Node - use env var or default
    const devUser = process.env.DATABRICKS_USER || 'dev-user@local';
    devUserCache = devUser;
    logger.info(`Using dev user: ${devUser}`);
    return devUser;
  }

  throw new Error('No X-Forwarded-User header found and not in development mode.');
}

export function getCurrentToken(req: Request): string | null {
  // Production: use SP OAuth credentials (don't use forwarded user tokens)
  if (!isLocalDevelopment()) {
    return null;
  }

  // Development: env var
  return process.env.DATABRICKS_TOKEN || null;
}

export function getWorkspaceUrl(appUrl?: string): string {
  if (workspaceUrlCache) return workspaceUrlCache;

  // Try DATABRICKS_WORKSPACE_URL
  let host = process.env.DATABRICKS_WORKSPACE_URL;
  if (host) {
    workspaceUrlCache = host.replace(/\/+$/, '');
    return workspaceUrlCache;
  }

  // Try DATABRICKS_HOST
  host = process.env.DATABRICKS_HOST;
  if (host) {
    workspaceUrlCache = host.replace(/\/+$/, '');
    return workspaceUrlCache;
  }

  // Derive from app URL if provided
  if (appUrl) {
    const match = appUrl.match(/-(\d+)\.(\d+)\.(azure\.)?databricksapps\.com/);
    if (match) {
      const [, workspaceId, region, isAzure] = match;
      workspaceUrlCache = isAzure
        ? `https://adb-${workspaceId}.${region}.azuredatabricks.net`
        : `https://adb-${workspaceId}.${region}.databricks.com`;
      return workspaceUrlCache;
    }
  }

  logger.error('Could not determine workspace URL from any source');
  return '';
}

export function getUserCredentials(req: Request): { host: string | null; token: string | null } {
  // Try forwarded headers (production)
  const host = req.headers['x-forwarded-host'] as string | undefined;
  const token = req.headers['x-forwarded-access-token'] as string | undefined;
  if (host && token) return { host, token };

  // Env vars (development)
  const envHost = process.env.DATABRICKS_HOST || null;
  const envToken = process.env.DATABRICKS_TOKEN || null;
  if (envHost && envToken) return { host: envHost, token: envToken };

  return { host: envHost, token: null };
}
