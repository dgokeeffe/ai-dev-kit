import { memo, useCallback, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  Copy,
  MessageSquare,
  Send,
  Square,
  Wrench,
  X,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { FunLoader } from '@/components/FunLoader';
import type { Cluster, Message, TodoItem, Warehouse } from '@/lib/types';

// Combined activity item for display
interface ActivityItem {
  id: string;
  type: 'thinking' | 'tool_use' | 'tool_result';
  content: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  isError?: boolean;
  timestamp: number;
}

// Code block with copy-to-clipboard button
function CodeBlock({ children, ...props }: React.ComponentPropsWithoutRef<'pre'>) {
  const [copied, setCopied] = useState(false);

  const getTextContent = (node: React.ReactNode): string => {
    if (typeof node === 'string') return node;
    if (Array.isArray(node)) return node.map(getTextContent).join('');
    if (node && typeof node === 'object' && 'props' in node) {
      return getTextContent((node as React.ReactElement).props.children);
    }
    return '';
  };

  const handleCopy = () => {
    const text = getTextContent(children).replace(/\n$/, '');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group">
      <button
        onClick={handleCopy}
        className="absolute right-1.5 top-1.5 p-1 rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100 transition-opacity hover:text-[var(--color-text-primary)]"
        title={copied ? 'Copied!' : 'Copy code'}
      >
        {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
      </button>
      <pre {...props}>{children}</pre>
    </div>
  );
}

const markdownComponents = {
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-[var(--color-accent-primary)] underline hover:text-[var(--color-accent-secondary)]">
      {children}
    </a>
  ),
  pre: (props: React.ComponentPropsWithoutRef<'pre'>) => <CodeBlock {...props} />,
};

// Minimal activity indicator - shows only current tool being executed
function ActivitySection({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) return null;

  // Get the most recent tool_use item (current activity)
  const currentTool = [...items].reverse().find((item) => item.type === 'tool_use');

  if (!currentTool) return null;

  return (
    <div className="mb-2 flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
      <Wrench className="h-3 w-3 text-blue-500 animate-pulse" />
      <span className="truncate">
        Using {currentTool.toolName?.replace('mcp__databricks__', '')}...
      </span>
    </div>
  );
}

interface ChatPanelProps {
  messages: Message[];
  streamingText: string;
  activityItems: ActivityItem[];
  todos: TodoItem[];
  isStreaming: boolean;
  input: string;
  onInputChange: (value: string) => void;
  onSendMessage: () => void;
  onStopStreaming: () => void;
  // Config
  currentConversationTitle?: string;
  clusters: Cluster[];
  selectedClusterId?: string;
  onClusterChange: (id: string) => void;
  warehouses: Warehouse[];
  selectedWarehouseId?: string;
  onWarehouseChange: (id: string) => void;
  defaultCatalog: string;
  onCatalogChange: (value: string) => void;
  defaultSchema: string;
  onSchemaChange: (value: string) => void;
  // Panel control
  onClose?: () => void;
  className?: string;
}

export const ChatPanel = memo(function ChatPanel({
  messages,
  streamingText,
  activityItems,
  todos,
  isStreaming,
  input,
  onInputChange,
  onSendMessage,
  onStopStreaming,
  currentConversationTitle,
  clusters,
  selectedClusterId,
  onClusterChange,
  warehouses,
  selectedWarehouseId,
  onWarehouseChange,
  defaultCatalog,
  onCatalogChange,
  defaultSchema,
  onSchemaChange,
  onClose,
  className = '',
}: ChatPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const clusterDropdownRef = useRef<HTMLDivElement>(null);
  const warehouseDropdownRef = useRef<HTMLDivElement>(null);
  const [clusterDropdownOpen, setClusterDropdownOpen] = useState(false);
  const [warehouseDropdownOpen, setWarehouseDropdownOpen] = useState(false);
  const [showAllMessages, setShowAllMessages] = useState(false);

  // Performance optimization: Only render last 100 messages by default
  // This prevents DOM bloat with 1000+ message conversations
  const MESSAGE_RENDER_LIMIT = 100;
  const visibleMessages = useMemo(() => {
    if (showAllMessages || messages.length <= MESSAGE_RENDER_LIMIT) {
      return messages;
    }
    return messages.slice(-MESSAGE_RENDER_LIMIT);
  }, [messages, showAllMessages]);

  const hasHiddenMessages = messages.length > MESSAGE_RENDER_LIMIT && !showAllMessages;

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSendMessage();
    }
  }, [onSendMessage]);

  const handleLoadMore = useCallback(() => {
    setShowAllMessages(true);
  }, []);

  return (
    <div className={cn('flex flex-col h-full bg-[var(--color-background)]', className)}>
      {/* Chat Header */}
      <div className="flex h-10 items-center justify-between border-b border-[var(--color-border)] px-3 bg-[var(--color-bg-secondary)]/50 flex-shrink-0">
        <h2 className="font-medium text-[var(--color-text-heading)] truncate max-w-[120px] text-xs">
          {currentConversationTitle || 'Chat'}
        </h2>
        <div className="flex items-center gap-1.5">
          {/* Catalog.Schema Input */}
          <div className="flex items-center h-6 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] focus-within:ring-1 focus-within:ring-[var(--color-accent-primary)]/50">
            <input
              type="text"
              value={defaultCatalog}
              onChange={(e) => onCatalogChange(e.target.value)}
              placeholder="catalog"
              className="h-full w-14 px-1.5 bg-transparent text-[10px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none"
            />
            <span className="text-[var(--color-text-muted)] text-[10px]">.</span>
            <input
              type="text"
              value={defaultSchema}
              onChange={(e) => onSchemaChange(e.target.value)}
              placeholder="schema"
              className="h-full w-20 px-1.5 bg-transparent text-[10px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none"
            />
          </div>
          {/* Cluster Dropdown */}
          {clusters.length > 0 && (
            <div className="relative" ref={clusterDropdownRef}>
              <button
                onClick={() => setClusterDropdownOpen(!clusterDropdownOpen)}
                className="flex items-center h-6 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] text-[10px] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)]/30 px-1.5"
              >
                {(() => {
                  const selected = clusters.find((c) => c.cluster_id === selectedClusterId);
                  return selected ? (
                    <>
                      <span className={cn('w-1.5 h-1.5 rounded-full mr-1', selected.state === 'RUNNING' ? 'bg-green-500' : 'bg-gray-400')} />
                      <span className="max-w-[50px] truncate">{selected.cluster_name}</span>
                    </>
                  ) : (
                    <span className="text-[var(--color-text-muted)]">Cluster</span>
                  );
                })()}
                <ChevronDown className={cn('w-2.5 h-2.5 ml-0.5 transition-transform', clusterDropdownOpen && 'rotate-180')} />
              </button>
              {clusterDropdownOpen && (
                <div className="absolute right-0 top-full mt-1 w-40 max-h-40 overflow-y-auto rounded-md border border-[var(--color-border)] bg-[var(--color-background)] shadow-lg z-50">
                  {clusters.map((cluster) => (
                    <button
                      key={cluster.cluster_id}
                      onClick={() => { onClusterChange(cluster.cluster_id); setClusterDropdownOpen(false); }}
                      className={cn('w-full flex items-center gap-1.5 px-2 py-1 text-[10px] text-left hover:bg-[var(--color-bg-secondary)]', selectedClusterId === cluster.cluster_id && 'bg-[var(--color-bg-secondary)]')}
                    >
                      <span className={cn('w-1.5 h-1.5 rounded-full', cluster.state === 'RUNNING' ? 'bg-green-500' : 'bg-gray-400')} />
                      <span className="truncate">{cluster.cluster_name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {/* Warehouse Dropdown */}
          {warehouses.length > 0 && (
            <div className="relative" ref={warehouseDropdownRef}>
              <button
                onClick={() => setWarehouseDropdownOpen(!warehouseDropdownOpen)}
                className="flex items-center h-6 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] text-[10px] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)]/30 px-1.5"
              >
                {(() => {
                  const selected = warehouses.find((w) => w.warehouse_id === selectedWarehouseId);
                  return selected ? (
                    <>
                      <span className={cn('w-1.5 h-1.5 rounded-full mr-1', selected.state === 'RUNNING' ? 'bg-green-500' : 'bg-gray-400')} />
                      <span className="max-w-[50px] truncate">{selected.warehouse_name}</span>
                    </>
                  ) : (
                    <span className="text-[var(--color-text-muted)]">Warehouse</span>
                  );
                })()}
                <ChevronDown className={cn('w-2.5 h-2.5 ml-0.5 transition-transform', warehouseDropdownOpen && 'rotate-180')} />
              </button>
              {warehouseDropdownOpen && (
                <div className="absolute right-0 top-full mt-1 w-40 max-h-40 overflow-y-auto rounded-md border border-[var(--color-border)] bg-[var(--color-background)] shadow-lg z-50">
                  {warehouses.map((warehouse) => (
                    <button
                      key={warehouse.warehouse_id}
                      onClick={() => { onWarehouseChange(warehouse.warehouse_id); setWarehouseDropdownOpen(false); }}
                      className={cn('w-full flex items-center gap-1.5 px-2 py-1 text-[10px] text-left hover:bg-[var(--color-bg-secondary)]', selectedWarehouseId === warehouse.warehouse_id && 'bg-[var(--color-bg-secondary)]')}
                    >
                      <span className={cn('w-1.5 h-1.5 rounded-full', warehouse.state === 'RUNNING' ? 'bg-green-500' : 'bg-gray-400')} />
                      <span className="truncate">{warehouse.warehouse_name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {/* Close button */}
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
              title="Close chat"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3">
        {messages.length === 0 && !streamingText ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center max-w-xs">
              <MessageSquare className="mx-auto h-8 w-8 text-[var(--color-text-muted)]/40" />
              <h3 className="mt-2 text-sm font-medium text-[var(--color-text-heading)]">
                What can I help you build?
              </h3>
              <p className="mt-1 text-[10px] text-[var(--color-text-muted)]">
                I can help you build data pipelines, apps, and more on Databricks.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {/* Load more button for hidden older messages */}
            {hasHiddenMessages && (
              <div className="flex justify-center py-2">
                <button
                  onClick={handleLoadMore}
                  className="px-3 py-1.5 text-xs rounded-md bg-[var(--color-bg-secondary)] border border-[var(--color-border)] hover:bg-[var(--color-bg-tertiary)] transition-colors text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                >
                  Load {messages.length - MESSAGE_RENDER_LIMIT} older messages
                </button>
              </div>
            )}
            {visibleMessages.map((message) => (
              <div key={message.id} className={cn('flex', message.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div className={cn(
                  'max-w-[90%] rounded-lg px-2.5 py-1.5 shadow-sm',
                  message.role === 'user'
                    ? 'bg-[var(--color-accent-primary)] text-white'
                    : 'bg-[var(--color-bg-secondary)] border border-[var(--color-border)]/50',
                  message.is_error && 'bg-[var(--color-error)]/10 border-[var(--color-error)]/30'
                )}>
                  {message.role === 'assistant' ? (
                    <div className="prose prose-xs max-w-none text-[var(--color-text-primary)] text-xs leading-relaxed">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={markdownComponents}
                      >
                        {message.content}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap text-xs">{message.content}</p>
                  )}
                </div>
              </div>
            ))}
            {streamingText && (
              <div className="flex justify-start">
                <div className="max-w-[90%] rounded-lg px-2.5 py-1.5 bg-[var(--color-bg-secondary)] border border-[var(--color-border)]/50">
                  <div className="prose prose-xs max-w-none text-[var(--color-text-primary)] text-xs leading-relaxed">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                      {streamingText}
                    </ReactMarkdown>
                  </div>
                </div>
              </div>
            )}
            {activityItems.length > 0 && <ActivitySection items={activityItems} />}
            {isStreaming && (
              <div className="flex justify-start">
                <FunLoader todos={todos} className="py-1" />
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="border-t border-[var(--color-border)] p-2 bg-[var(--color-bg-secondary)]/30 flex-shrink-0">
        <div className="flex gap-1.5">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Claude..."
            rows={1}
            className="flex-1 resize-none rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-primary)]/50 disabled:opacity-50 transition-all"
            disabled={isStreaming}
          />
          {isStreaming ? (
            <Button onClick={onStopStreaming} className="h-8 w-8 rounded-md bg-red-600 hover:bg-red-700" title="Stop">
              <Square className="h-3 w-3" />
            </Button>
          ) : (
            <Button onClick={onSendMessage} disabled={!input.trim()} className="h-8 w-8 rounded-md">
              <Send className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
});

export type { ActivityItem };
