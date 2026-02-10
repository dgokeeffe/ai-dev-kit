import { cn } from '@/lib/utils';

interface OutputLine {
  id: string;
  timestamp: Date;
  level: 'info' | 'warning' | 'error';
  source?: string;
  message: string;
}

interface OutputPanelProps {
  lines: OutputLine[];
  className?: string;
}

export function OutputPanel({ lines, className = '' }: OutputPanelProps) {
  if (lines.length === 0) {
    return (
      <div className={cn('h-full flex items-center justify-center text-[var(--color-text-muted)] text-sm', className)}>
        No output yet
      </div>
    );
  }

  return (
    <div className={cn('h-full overflow-y-auto bg-[var(--color-background)] p-2 font-mono text-xs', className)}>
      {lines.map((line) => (
        <div
          key={line.id}
          className={cn(
            'py-0.5',
            line.level === 'error' && 'text-red-400',
            line.level === 'warning' && 'text-yellow-400',
            line.level === 'info' && 'text-[var(--color-text-primary)]'
          )}
        >
          <span className="text-[var(--color-text-muted)]">
            [{line.timestamp.toLocaleTimeString()}]
          </span>
          {line.source && (
            <span className="text-[var(--color-accent-primary)] ml-1">
              [{line.source}]
            </span>
          )}
          <span className="ml-1">{line.message}</span>
        </div>
      ))}
    </div>
  );
}

export type { OutputLine };
