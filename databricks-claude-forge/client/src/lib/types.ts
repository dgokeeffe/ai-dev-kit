// Project types
export interface Project {
  id: string;
  name: string;
  user_email: string;
  template?: string;
  created_at: string;
  conversations: Conversation[];
}

// Conversation types
export interface Conversation {
  id: string;
  project_id: string;
  title: string;
  created_at: string;
  session_id?: string;
  cluster_id?: string;
  warehouse_id?: string;
  default_catalog?: string;
  default_schema?: string;
  workspace_folder?: string;
  messages?: Message[];
}

// Message types
export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  is_error: boolean;
}

// Todo types (from Claude agent)
export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

// Branding config from backend
export interface BrandingConfig {
  app_title: string;
  partner_name: string;
  show_databricks_logo: boolean;
}

// User info type
export interface UserInfo {
  user: string | null;
  workspace_url: string | null;
  database_available: boolean;
  lakebase_configured: boolean;
  lakebase_error: string | null;
  branding?: BrandingConfig;
}

// Cluster types
export interface Cluster {
  cluster_id: string;
  cluster_name: string;
  state: 'RUNNING' | 'PENDING' | 'TERMINATED' | 'RESTARTING' | 'TERMINATING' | 'ERROR' | 'UNKNOWN';
  spark_version?: string;
  node_type_id?: string;
}

// Warehouse types
export interface Warehouse {
  warehouse_id: string;
  warehouse_name: string;
  state: 'RUNNING' | 'STOPPED' | 'STARTING' | 'STOPPING' | 'DELETED' | 'DELETING';
  cluster_size?: string;
  warehouse_type?: string;
}

// File types for the editor
export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  size?: number;
  modified?: string;
}

export interface FileContent {
  path: string;
  content: string;
  encoding?: string;
  size?: number;
  modified?: string;
}

// Deploy types
export interface DeployStatus {
  status: 'idle' | 'deploying' | 'success' | 'error';
  app_url?: string;
  error?: string;
  started_at?: string;
  completed_at?: string;
}

export interface DeployLog {
  timestamp: string;
  level: 'info' | 'warning' | 'error';
  message: string;
}

// Skill types
export interface Skill {
  name: string;
  description: string;
  content?: string;
}

// Agent event types
export interface AgentEvent {
  type: string;
  [key: string]: unknown;
}
