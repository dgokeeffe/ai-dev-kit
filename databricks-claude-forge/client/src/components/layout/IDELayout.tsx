import { ReactNode, useRef, useEffect } from 'react';
import { GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ActivityBar, ActivityType } from './ActivityBar';
import { BottomPanel, BottomPanelTab } from './BottomPanel';

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
  bottomPanelHeight = 200,
  onBottomPanelHeightChange,
  isBottomPanelOpen = false,
  onBottomPanelToggle,
  isClaudeMaximized = false,
  maximizedContent,
  bottomPanelTab = 'terminal',
  onBottomPanelTabChange,
  className = '',
}: IDELayoutProps) {
  const leftResizeRef = useRef<HTMLDivElement>(null);
  const rightResizeRef = useRef<HTMLDivElement>(null);

  // Left sidebar resize
  useEffect(() => {
    const resizeEl = leftResizeRef.current;
    if (!resizeEl || !onLeftSidebarWidthChange) return;

    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    const handleMouseDown = (e: MouseEvent) => {
      isResizing = true;
      startX = e.clientX;
      startWidth = leftSidebarWidth;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const deltaX = e.clientX - startX;
      const newWidth = Math.min(Math.max(startWidth + deltaX, 150), 400);
      onLeftSidebarWidthChange(newWidth);
    };

    const handleMouseUp = () => {
      isResizing = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    resizeEl.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      resizeEl.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [leftSidebarWidth, onLeftSidebarWidthChange]);

  // Right sidebar resize
  useEffect(() => {
    const resizeEl = rightResizeRef.current;
    if (!resizeEl || !onRightSidebarWidthChange) return;

    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    const handleMouseDown = (e: MouseEvent) => {
      isResizing = true;
      startX = e.clientX;
      startWidth = rightSidebarWidth;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const deltaX = startX - e.clientX;
      const newWidth = Math.min(Math.max(startWidth + deltaX, 250), 500);
      onRightSidebarWidthChange(newWidth);
    };

    const handleMouseUp = () => {
      isResizing = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    resizeEl.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      resizeEl.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [rightSidebarWidth, onRightSidebarWidthChange]);

  const showLeftSidebar = activeActivity === 'explorer' || activeActivity === 'search' || activeActivity === 'git';

  return (
    <div className={cn('flex h-full', className)}>
      {/* Activity Bar */}
      <ActivityBar
        activeActivity={activeActivity}
        onActivityChange={onActivityChange}
      />

      {/* Left Sidebar */}
      {showLeftSidebar && leftSidebar && (
        <>
          <div
            className="flex-shrink-0 overflow-hidden border-r border-[var(--color-border)]"
            style={{ width: leftSidebarWidth }}
          >
            {leftSidebar}
          </div>
          {/* Resize handle */}
          <div
            ref={leftResizeRef}
            className="w-1 bg-[var(--color-border)] hover:bg-[var(--color-accent-primary)]/50 cursor-col-resize flex items-center justify-center flex-shrink-0"
          >
            <GripVertical className="h-4 w-4 text-[var(--color-text-muted)]" />
          </div>
        </>
      )}

      {/* Main Content Area (Editor + Bottom Panel) */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Editor Area or Maximized Claude Terminal */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {isClaudeMaximized && maximizedContent ? maximizedContent : children}
        </div>

        {/* Bottom Panel */}
        {!isClaudeMaximized && bottomPanel && onBottomPanelToggle && onBottomPanelTabChange && onBottomPanelHeightChange && (
          <BottomPanel
            isOpen={isBottomPanelOpen}
            onToggle={onBottomPanelToggle}
            activeTab={bottomPanelTab}
            onTabChange={onBottomPanelTabChange}
            height={bottomPanelHeight}
            onHeightChange={onBottomPanelHeightChange}
          >
            {bottomPanel}
          </BottomPanel>
        )}
      </div>

      {/* Right Sidebar (Chat) - hidden when maximized */}
      {!isClaudeMaximized && isRightSidebarOpen && rightSidebar && (
        <>
          {/* Resize handle */}
          <div
            ref={rightResizeRef}
            className="w-1 bg-[var(--color-border)] hover:bg-[var(--color-accent-primary)]/50 cursor-col-resize flex items-center justify-center flex-shrink-0"
          >
            <GripVertical className="h-4 w-4 text-[var(--color-text-muted)]" />
          </div>
          <div
            className="flex-shrink-0 overflow-hidden border-l border-[var(--color-border)]"
            style={{ width: rightSidebarWidth }}
          >
            {rightSidebar}
          </div>
        </>
      )}
    </div>
  );
}
