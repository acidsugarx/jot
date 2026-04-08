import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional label for identifying which window crashed in logs */
  windowLabel?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * React error boundary that catches unhandled exceptions in the component tree.
 * Prevents white-screen crashes — shows a recovery UI with a reload button instead.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const label = this.props.windowLabel ?? 'unknown';
    console.error(`[ErrorBoundary:${label}] Unhandled exception:`, error, errorInfo);
  }

  private handleReload = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen w-screen items-center justify-center bg-zinc-950 text-zinc-300">
          <div className="max-w-md space-y-4 px-6 text-center">
            <p className="font-mono text-sm text-red-400">
              {this.props.windowLabel ?? 'App'} crashed
            </p>
            <pre className="max-h-32 overflow-auto rounded bg-zinc-900 p-3 text-left font-mono text-[11px] text-zinc-500">
              {this.state.error?.message ?? 'Unknown error'}
            </pre>
            <button
              type="button"
              onClick={this.handleReload}
              className="rounded bg-zinc-800 px-4 py-1.5 font-mono text-xs text-zinc-300 transition-colors hover:bg-zinc-700"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
