import { ReactNode, useCallback } from 'react';
import {
  Group,
  Panel,
  Separator,
  usePanelRef,
  PanelImperativeHandle,
  PanelSize,
} from 'react-resizable-panels';
import { GripVertical, GripHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ActivityBar, ActivityType } from './ActivityBar';
import { BottomPanelTab } from './BottomPanel';

interface IDELayoutProps {
  // Activity bar
  activeActivity: ActivityType | null;
  onActivityChange: (activity: ActivityType | null) => void;

  // Left sidebar content
  leftSidebar?: ReactNode;
  leftSidebarWidth?: number;
  onLeftSidebarWidthChange?: (width: number) => void;

  // Main editor area
  children: ReactNode;

  // Right sidebar (chat)
  rightSidebar?: ReactNode;
  rightSidebarWidth?: number;
  onRightSidebarWidthChange?: (width: number) => void;
  isRightSidebarOpen?: boolean;

  // Claude terminal maximize
  isClaudeMaximized?: boolean;
  maximizedContent?: ReactNode;

  // Bottom panel
  bottomPanel?: ReactNode;
  bottomPanelHeight?: number;
  onBottomPanelHeightChange?: (height: number) => void;
  isBottomPanelOpen?: boolean;
  onBottomPanelToggle?: () => void;
  bottomPanelTab?: BottomPanelTab;
  onBottomPanelTabChange?: (tab: BottomPanelTab) => void;

  className?: string;
}

// Custom resize handle for vertical (column) resizing
function VerticalResizeHandle({ className }: { className?: string }) {
  return (
    <Separator
      className={cn(
        'w-1 bg-[var(--color-border)] hover:bg-[var(--color-accent-primary)]/50 flex items-center justify-center transition-colors',
        className
      )}
    >
      <GripVertical className="h-4 w-4 text-[var(--color-text-muted)]" />
    </Separator>
  );
}

// Custom resize handle for horizontal (row) resizing
function HorizontalResizeHandle({ className }: { className?: string }) {
  return (
    <Separator
      className={cn(
        'h-1 bg-[var(--color-border)] hover:bg-[var(--color-accent-primary)]/50 flex items-center justify-center transition-colors',
        className
      )}
    >
      <GripHorizontal className="h-4 w-4 text-[var(--color-text-muted)]" />
    </Separator>
  );
}

// Bottom panel header with tabs
function BottomPanelHeader({
  isOpen,
  onToggle,
  activeTab,
  onTabChange,
}: {
  isOpen: boolean;
  onToggle: () => void;
  activeTab: BottomPanelTab;
  onTabChange: (tab: BottomPanelTab) => void;
}) {
  const tabs: { id: BottomPanelTab; label: string }[] = [
    { id: 'terminal', label: 'Terminal' },
    { id: 'output', label: 'Output' },
    { id: 'deploy', label: 'Deploy' },
    { id: 'preview', label: 'Preview' },
  ];

  return (
    <div className="flex items-center h-8 px-2 bg-[var(--color-bg-secondary)] border-b border-[var(--color-border)]">
      <div className="flex items-center gap-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              onTabChange(tab.id);
              if (!isOpen) onToggle();
            }}
            className={cn(
              'px-2 py-1 text-xs font-medium rounded transition-colors',
              activeTab === tab.id && isOpen
                ? 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-heading)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="flex-1" />
      <button
        onClick={onToggle}
        className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
      >
        {isOpen ? '▼' : '▲'}
      </button>
    </div>
  );
}

export function IDELayout({
  activeActivity,
  onActivityChange,
  leftSidebar,
  leftSidebarWidth = 200,
  onLeftSidebarWidthChange,
  children,
  rightSidebar,
  rightSidebarWidth = 320,
  onRightSidebarWidthChange,
  isRightSidebarOpen = true,
  bottomPanel,
  bottomPanelHeight: _bottomPanelHeight = 200,
  onBottomPanelHeightChange,
  isBottomPanelOpen = false,
  onBottomPanelToggle,
  isClaudeMaximized = false,
  maximizedContent,
  bottomPanelTab = 'terminal',
  onBottomPanelTabChange,
  className = '',
}: IDELayoutProps) {
  const bottomPanelRef = usePanelRef();

  const showLeftSidebar =
    activeActivity === 'explorer' ||
    activeActivity === 'search' ||
    activeActivity === 'git';

  // Convert pixel widths to percentages for react-resizable-panels
  // Assuming a base container width of around 1200px for initial sizing
  const leftSidebarPercent = (leftSidebarWidth / 1200) * 100;
  const rightSidebarPercent = (rightSidebarWidth / 1200) * 100;

  // Handle left sidebar resize
  const handleLeftResize = useCallback(
    (size: PanelSize) => {
      if (onLeftSidebarWidthChange) {
        onLeftSidebarWidthChange(Math.round(size.inPixels));
      }
    },
    [onLeftSidebarWidthChange]
  );

  // Handle right sidebar resize
  const handleRightResize = useCallback(
    (size: PanelSize) => {
      if (onRightSidebarWidthChange) {
        onRightSidebarWidthChange(Math.round(size.inPixels));
      }
    },
    [onRightSidebarWidthChange]
  );

  // Handle bottom panel resize
  const handleBottomResize = useCallback(
    (size: PanelSize) => {
      if (onBottomPanelHeightChange) {
        onBottomPanelHeightChange(Math.round(size.inPixels));
      }
    },
    [onBottomPanelHeightChange]
  );

  // Toggle bottom panel
  const handleBottomPanelToggle = useCallback(() => {
    if (onBottomPanelToggle) {
      onBottomPanelToggle();
    }
    const panel = bottomPanelRef.current as PanelImperativeHandle | null;
    if (panel) {
      if (isBottomPanelOpen) {
        panel.collapse();
      } else {
        panel.expand();
      }
    }
  }, [isBottomPanelOpen, onBottomPanelToggle, bottomPanelRef]);

  return (
    <div className={cn('flex h-full ide-layout-container', className)}>
      {/* Activity Bar - fixed width */}
      <ActivityBar
        activeActivity={activeActivity}
        onActivityChange={onActivityChange}
      />

      {/* Main resizable area */}
      <Group
        orientation="horizontal"
        className="flex-1"
      >
        {/* Left Sidebar Panel */}
        {showLeftSidebar && leftSidebar && (
          <>
            <Panel
              id="left-sidebar"
              defaultSize={leftSidebarPercent}
              minSize={10}
              maxSize={30}
              onResize={handleLeftResize}
              className="overflow-hidden"
            >
              <div className="h-full border-r border-[var(--color-border)]">
                {leftSidebar}
              </div>
            </Panel>
            <VerticalResizeHandle />
          </>
        )}

        {/* Main Content Panel (Editor + Bottom) */}
        <Panel
          id="main-content"
          defaultSize={100 - leftSidebarPercent - rightSidebarPercent}
          minSize={30}
        >
          <Group orientation="vertical">
            {/* Editor Area */}
            <Panel
              id="editor"
              defaultSize={isBottomPanelOpen ? 70 : 100}
              minSize={20}
            >
              <div className="h-full overflow-hidden">
                {isClaudeMaximized && maximizedContent
                  ? maximizedContent
                  : children}
              </div>
            </Panel>

            {/* Bottom Panel */}
            {!isClaudeMaximized &&
              bottomPanel &&
              onBottomPanelToggle &&
              onBottomPanelTabChange && (
                <>
                  <HorizontalResizeHandle />
                  <Panel
                    id="bottom-panel"
                    panelRef={bottomPanelRef}
                    defaultSize={isBottomPanelOpen ? 30 : 0}
                    minSize={0}
                    maxSize={50}
                    collapsible
                    collapsedSize={0}
                    onResize={handleBottomResize}
                  >
                    <div className="h-full flex flex-col bg-[var(--color-bg-secondary)]">
                      <BottomPanelHeader
                        isOpen={isBottomPanelOpen}
                        onToggle={handleBottomPanelToggle}
                        activeTab={bottomPanelTab}
                        onTabChange={onBottomPanelTabChange}
                      />
                      <div className="flex-1 overflow-hidden">{bottomPanel}</div>
                    </div>
                  </Panel>
                </>
              )}
          </Group>
        </Panel>

        {/* Right Sidebar (Chat) */}
        {!isClaudeMaximized && rightSidebar && isRightSidebarOpen && (
          <>
            <VerticalResizeHandle />
            <Panel
              id="right-sidebar"
              defaultSize={rightSidebarPercent}
              minSize={15}
              maxSize={40}
              onResize={handleRightResize}
              className="overflow-hidden"
            >
              <div className="h-full border-l border-[var(--color-border)]">
                {rightSidebar}
              </div>
            </Panel>
          </>
        )}
      </Group>
    </div>
  );
}
