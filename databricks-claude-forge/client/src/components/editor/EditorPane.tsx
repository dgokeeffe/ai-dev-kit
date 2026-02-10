import { useCallback, memo } from 'react';
import { CodeEditor } from './CodeEditor';
import { FileTabs } from './FileTabs';

export interface OpenFile {
  path: string;
  name: string;
  content: string;
  isDirty: boolean;
  originalContent: string;
}

interface EditorPaneProps {
  paneId: string;
  tabs: OpenFile[];
  activeTabPath?: string;
  onTabSelect: (paneId: string, path: string) => void;
  onTabClose: (paneId: string, path: string) => void;
  onContentChange: (paneId: string, path: string, content: string) => void;
  isFocused?: boolean;
  onFocus?: (paneId: string) => void;
  className?: string;
}

export const EditorPane = memo(function EditorPane({
  paneId,
  tabs,
  activeTabPath,
  onTabSelect,
  onTabClose,
  onContentChange,
  isFocused = false,
  onFocus,
  className = '',
}: EditorPaneProps) {
  const activeFile = tabs.find((t) => t.path === activeTabPath);

  const handleTabSelect = useCallback(
    (path: string) => {
      onTabSelect(paneId, path);
    },
    [paneId, onTabSelect]
  );

  const handleTabClose = useCallback(
    (path: string) => {
      onTabClose(paneId, path);
    },
    [paneId, onTabClose]
  );

  const handleContentChange = useCallback(
    (content: string) => {
      if (activeTabPath) {
        onContentChange(paneId, activeTabPath, content);
      }
    },
    [paneId, activeTabPath, onContentChange]
  );

  const handleClick = useCallback(() => {
    onFocus?.(paneId);
  }, [paneId, onFocus]);

  return (
    <div
      className={`flex flex-col h-full min-w-0 ${className}`}
      onClick={handleClick}
    >
      {/* Tabs */}
      <FileTabs
        tabs={tabs.map((f) => ({ path: f.path, name: f.name, isDirty: f.isDirty }))}
        activeTab={activeTabPath}
        onTabSelect={handleTabSelect}
        onTabClose={handleTabClose}
        className={isFocused ? 'border-b-2 border-b-[var(--color-accent-primary)]' : ''}
      />

      {/* Editor */}
      <div className="flex-1 overflow-hidden">
        {activeFile ? (
          <CodeEditor
            value={activeFile.content}
            onChange={handleContentChange}
            filePath={activeFile.path}
          />
        ) : (
          <div className="h-full flex items-center justify-center text-[var(--color-text-muted)] text-sm">
            {tabs.length === 0 ? 'No files open' : 'Select a file to edit'}
          </div>
        )}
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  // Only re-render if this pane's data actually changed
  return (
    prevProps.paneId === nextProps.paneId &&
    prevProps.activeTabPath === nextProps.activeTabPath &&
    prevProps.tabs === nextProps.tabs &&
    prevProps.isFocused === nextProps.isFocused
  );
});
