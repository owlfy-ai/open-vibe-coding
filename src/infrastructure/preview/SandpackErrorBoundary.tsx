import { Component, type ErrorInfo, type ReactNode } from "react";

export interface PreviewErrorCardProps {
  readonly title: string;
  readonly detail?: string | null;
  readonly hint?: string | null;
  readonly retryLabel?: string | null;
  readonly onRetry?: (() => void) | null;
}

/**
 * Centered, recoverable error card shown in place of the Sandpack preview when
 * the current session's files can't be compiled (e.g. invalid `package.json`).
 * Reuses the visual language of the loading card.
 */
export function PreviewErrorCard({
  title,
  detail,
  hint,
  retryLabel,
  onRetry,
}: PreviewErrorCardProps) {
  return (
    <div className="ob-preview-error" role="alert">
      <div className="ob-preview-error-card">
        <svg
          className="ob-preview-error-icon"
          viewBox="0 0 24 24"
          width="22"
          height="22"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
        </svg>
        <strong>{title}</strong>
        {detail ? <code className="ob-preview-error-detail">{detail}</code> : null}
        {hint ? <small>{hint}</small> : null}
        {onRetry && retryLabel ? (
          <button type="button" className="ob-preview-error-retry" onClick={onRetry}>
            {retryLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

interface BoundaryProps {
  /**
   * Render the fallback for a caught error. Receives a `retry` callback that
   * clears the error and remounts the children. Auto-recovery on data change
   * is handled by the parent keying this boundary on `revision`.
   */
  readonly renderFallback: (error: Error, retry: () => void) => ReactNode;
  readonly children: ReactNode;
}

interface BoundaryState {
  readonly error: Error | null;
  readonly attempt: number;
}

/**
 * Contains render errors thrown by the Sandpack runtime so a single broken
 * file can never unmount the whole app. The boundary lives inside the workspace
 * pane, so only the affected session goes down — the chat, sidebar, and every
 * other session keep working.
 */
export class SandpackErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: Error): Pick<BoundaryState, "error"> {
    return { error };
  }

  override componentDidCatch(error: Error, _info: ErrorInfo): void {
    // Intentionally not re-thrown — surfacing to the console is enough.
    console.error("[SandpackErrorBoundary] preview render failed:", error);
  }

  private readonly retry = (): void => {
    this.setState(({ attempt }) => ({ error: null, attempt: attempt + 1 }));
  };

  override render(): ReactNode {
    if (this.state.error) {
      return this.props.renderFallback(this.state.error, this.retry);
    }
    // A keyed host forces the children to remount on retry, so a previously
    // crashed subtree mounts fresh.
    return (
      <div key={this.state.attempt} className="ob-preview-boundary-host">
        {this.props.children}
      </div>
    );
  }
}
