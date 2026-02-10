import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind CSS classes with clsx
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Get file extension from path
 */
export function getFileExtension(path: string): string {
  const parts = path.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

/**
 * Get language mode for CodeMirror based on file extension
 */
export function getLanguageFromExtension(ext: string): string {
  const langMap: Record<string, string> = {
    py: 'python',
    python: 'python',
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    sql: 'sql',
    yaml: 'yaml',
    yml: 'yaml',
    json: 'json',
    md: 'markdown',
    markdown: 'markdown',
    html: 'html',
    htm: 'html',
    css: 'css',
    sh: 'shell',
    bash: 'shell',
    txt: 'text',
  };
  return langMap[ext] || 'text';
}

/**
 * Get icon name for file type
 */
export function getFileIcon(path: string, isDirectory: boolean): string {
  if (isDirectory) return 'folder';
  
  const ext = getFileExtension(path);
  const iconMap: Record<string, string> = {
    py: 'python',
    js: 'javascript',
    jsx: 'react',
    ts: 'typescript',
    tsx: 'react',
    sql: 'database',
    yaml: 'settings',
    yml: 'settings',
    json: 'json',
    md: 'markdown',
    html: 'html',
    css: 'css',
    txt: 'file-text',
  };
  return iconMap[ext] || 'file';
}

/**
 * Format file size in human readable format
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Format date for display
 */
export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Debounce function
 */
export function debounce<T extends (...args: Parameters<T>) => void>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Format a date as relative time (e.g., "2 hours ago")
 */
export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);

  if (diffSeconds < 60) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffWeeks < 4) return `${diffWeeks}w ago`;
  if (diffMonths < 12) return `${diffMonths}mo ago`;
  return date.toLocaleDateString();
}
