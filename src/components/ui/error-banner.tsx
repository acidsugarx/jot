import { useEffect } from 'react';
import { AlertCircle, X } from 'lucide-react';

interface ErrorBannerProps {
  error: string | null;
  onRetry?: () => void;
  onDismiss: () => void;
}

export function ErrorBanner({ error, onRetry, onDismiss }: ErrorBannerProps) {
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(onDismiss, 10000);
    return () => clearTimeout(timer);
  }, [error, onDismiss]);

  if (!error) return null;

  return (
    <div className="flex items-center gap-2 border-b border-red-500/20 bg-red-500/5 px-4 py-2">
      <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />
      <span className="min-w-0 flex-1 truncate text-xs text-red-300">
        {error.length > 100 ? error.slice(0, 100) + '...' : error}
      </span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded px-2 py-0.5 text-[10px] font-medium text-red-300 hover:bg-red-500/10 transition-colors"
        >
          Retry
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        className="rounded p-0.5 text-red-400/60 hover:text-red-300 transition-colors"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
