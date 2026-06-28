import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Catches rendering errors in the child tree and displays a fallback UI so the
 * sidebar + title bar remain functional even when the main view crashes.
 *
 * Matches the kern dark-room palette (DesignGuide §2). The user can dismiss the
 * error state or reload to attempt recovery — no hard app-wide crash screen.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Log to the console so developers can inspect the stack during dev.
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
          <p className="text-[10px] tracking-[0.2em] uppercase text-fault-vector">
            rendering error
          </p>
          <p className="text-xs text-zinc-300 max-w-md text-center leading-relaxed">
            The active view encountered an error and could not be rendered. The
            sidebar and controls are still available.
          </p>
          {this.state.error && (
            <pre className="text-[11px] text-zinc-500 font-mono max-w-lg text-center leading-relaxed line-clamp-4 overflow-hidden">
              {this.state.error.message}
            </pre>
          )}
          <div className="flex gap-2 mt-2">
            <button
              onClick={this.handleReload}
              className="px-3 py-1.5 text-xs text-bg-core bg-signal-high hover:opacity-80 font-semibold transition-opacity"
            >
              reload view
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
