import {
  Files,
  Search,
  MessageSquare,
  GitBranch,
  Settings,
  LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export type ActivityType = 'explorer' | 'search' | 'chat' | 'git';

interface ActivityItem {
  id: ActivityType;
  icon: LucideIcon;
  label: string;
}

const activities: ActivityItem[] = [
  { id: 'explorer', icon: Files, label: 'Explorer' },
  { id: 'search', icon: Search, label: 'Search' },
  { id: 'git', icon: GitBranch, label: 'Source Control' },
  { id: 'chat', icon: MessageSquare, label: 'Chat' },
];

interface ActivityBarProps {
  activeActivity: ActivityType | null;
  onActivityChange: (activity: ActivityType | null) => void;
  className?: string;
}

export function ActivityBar({
  activeActivity,
  onActivityChange,
  className = '',
}: ActivityBarProps) {
  const handleClick = (id: ActivityType) => {
    // Toggle off if clicking the active item
    if (activeActivity === id) {
      onActivityChange(null);
    } else {
      onActivityChange(id);
    }
  };

  return (
    <div
      className={cn(
        'flex flex-col w-12 bg-[var(--color-bg-secondary)] border-r border-[var(--color-border)]',
        className
      )}
    >
      {/* Activity buttons */}
      <div className="flex flex-col">
        {activities.map((activity) => {
          const Icon = activity.icon;
          const isActive = activeActivity === activity.id;
          return (
            <button
              key={activity.id}
              onClick={() => handleClick(activity.id)}
              className={cn(
                'relative flex items-center justify-center h-12 w-12 transition-colors',
                isActive
                  ? 'text-[var(--color-text-primary)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
              )}
              title={activity.label}
            >
              {/* Active indicator */}
              {isActive && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-[var(--color-accent-primary)]" />
              )}
              <Icon className="h-5 w-5" />
            </button>
          );
        })}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Bottom actions */}
      <div className="flex flex-col">
        <button
          className="flex items-center justify-center h-12 w-12 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
          title="Settings"
        >
          <Settings className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
