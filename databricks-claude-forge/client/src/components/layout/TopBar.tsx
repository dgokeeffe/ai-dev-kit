import { Link, useLocation } from 'react-router-dom';
import { useUser } from '@/contexts/UserContext';

interface TopBarProps {
  projectName?: string;
}

export function TopBar({ projectName }: TopBarProps) {
  const location = useLocation();
  const { user, branding } = useUser();

  // Extract username from email for display
  const displayName = user?.split('@')[0] || '';

  return (
    <header className="fixed top-0 left-0 right-0 z-30 h-[var(--header-height)] bg-[var(--color-background)]/70 backdrop-blur-xl backdrop-saturate-150 border-b border-[var(--color-border)]/40 shadow-sm">
      <div className="flex items-center justify-between h-full px-4 lg:px-6">
        {/* Left Section - Logo & Name */}
        <div className="flex items-center gap-4">
          {/* Databricks Logo */}
          <Link to="/" className="flex items-center gap-3">
            <svg className="w-8 h-8 text-[#FF3621]" viewBox="0 0 36 36" fill="currentColor">
              <path d="M18 2.4L2.4 11.4V24.6L18 33.6L33.6 24.6V11.4L18 2.4ZM18 6.9L28.8 13.2L18 19.5L7.2 13.2L18 6.9ZM5.4 15.3L16.5 21.75V30.3L5.4 23.7V15.3ZM19.5 30.3V21.75L30.6 15.3V23.7L19.5 30.3Z"/>
            </svg>
            <h1 className="text-xl font-semibold tracking-tight text-[var(--color-text-heading)]">
              {branding.app_title}
            </h1>
          </Link>

          {/* Partner Badge */}
          {branding.partner_name && (
            <span className="px-2.5 py-0.5 text-xs font-medium rounded-full bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)] border border-[var(--color-border)]">
              {branding.partner_name}
            </span>
          )}

          {/* Project Name Breadcrumb */}
          {projectName && (
            <>
              <span className="text-[var(--color-text-muted)]">/</span>
              <span className="text-[var(--color-text-primary)] font-medium truncate max-w-[200px]">
                {projectName}
              </span>
            </>
          )}
        </div>

        {/* Right Section - Navigation & User */}
        <div className="flex items-center gap-6">
          {/* Navigation */}
          <nav className="flex items-center gap-1">
            <Link
              to="/"
              className={`
                relative px-4 py-2 text-sm font-medium transition-colors duration-300
                ${
                  location.pathname === '/'
                    ? 'text-[var(--color-foreground)]'
                    : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]'
                }
              `}
            >
              <span className="relative z-10">Projects</span>
              {location.pathname === '/' && (
                <span className="absolute bottom-1.5 left-4 right-4 h-0.5 bg-[var(--color-accent-primary)] rounded-full" />
              )}
            </Link>
            <Link
              to="/doc"
              className={`
                relative px-4 py-2 text-sm font-medium transition-colors duration-300
                ${
                  location.pathname === '/doc'
                    ? 'text-[var(--color-foreground)]'
                    : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]'
                }
              `}
            >
              <span className="relative z-10">Docs</span>
              {location.pathname === '/doc' && (
                <span className="absolute bottom-1.5 left-4 right-4 h-0.5 bg-[var(--color-accent-primary)] rounded-full" />
              )}
            </Link>
          </nav>

          {/* User Email */}
          {displayName && (
            <div
              className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--color-bg-secondary)] border border-[var(--color-border)] shadow-sm"
              title={user || undefined}
            >
              <div className="w-6 h-6 rounded-full bg-[var(--color-accent-primary)] flex items-center justify-center text-white text-xs font-medium">
                {displayName.charAt(0).toUpperCase()}
              </div>
              <span className="text-sm text-[var(--color-text-primary)] max-w-[120px] truncate">
                {displayName}
              </span>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
