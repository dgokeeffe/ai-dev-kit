import { Pool, PoolClient } from 'pg';
import { logger } from '../services/logger';

let pool: Pool | null = null;

export function isPostgresConfigured(): boolean {
  return !!(
    process.env.LAKEBASE_PG_URL ||
    (process.env.PGHOST && process.env.PGDATABASE)
  );
}

function getPool(): Pool {
  if (!pool) {
    if (process.env.LAKEBASE_PG_URL) {
      pool = new Pool({
        connectionString: process.env.LAKEBASE_PG_URL,
        max: 10,
        ssl: { rejectUnauthorized: false },
      });
    } else {
      pool = new Pool({
        host: process.env.PGHOST,
        port: parseInt(process.env.PGPORT || '5432', 10),
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        database: process.env.PGDATABASE,
        max: 10,
        ssl: process.env.ENV === 'production' ? { rejectUnauthorized: false } : undefined,
      });
    }
  }
  return pool;
}

export async function testConnection(): Promise<string | null> {
  if (!isPostgresConfigured()) return 'Database not configured';
  try {
    const client = await getPool().connect();
    await client.query('SELECT 1');
    client.release();
    return null;
  } catch (err) {
    return String(err);
  }
}

export async function initDatabase(): Promise<void> {
  if (!isPostgresConfigured()) {
    logger.warn('Database not configured. Running without persistence.');
    return;
  }

  const client = await getPool().connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id UUID PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        user_email VARCHAR(255) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_projects_user_email ON projects(user_email)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id UUID PRIMARY KEY,
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title VARCHAR(500) DEFAULT 'New Conversation',
        session_id VARCHAR(255),
        cluster_id VARCHAR(255),
        warehouse_id VARCHAR(255),
        default_catalog VARCHAR(255),
        default_schema VARCHAR(255),
        workspace_folder VARCHAR(500),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_conversations_project_id ON conversations(project_id)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id UUID PRIMARY KEY,
        conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role VARCHAR(20) NOT NULL,
        content TEXT NOT NULL,
        is_error BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id)`);

    logger.info('Database tables initialized successfully');
  } finally {
    client.release();
  }
}

export async function query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }> {
  if (!isPostgresConfigured()) {
    throw new Error('Database not configured');
  }
  return getPool().query(text, params);
}

export async function getClient(): Promise<PoolClient> {
  return getPool().connect();
}
