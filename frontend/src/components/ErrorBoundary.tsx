import React from 'react';

/**
 * The last thing between a render bug and a black screen.
 *
 * React unmounts the entire tree when a render throws, and on a dark theme that is
 * indistinguishable from the app having died — which is exactly how the
 * `confidence: null` crash presented: press Scan, screen goes black, no clue. A
 * boundary cannot fix the bug, but it can name it, and it keeps the reload button
 * reachable without the console.
 *
 * It deliberately does not try to recover: the state that produced the throw is
 * still there, so re-rendering the same tree would only throw again.
 */

interface Props {
    children: React.ReactNode;
}

interface State {
    error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
    state: State = { error: null };

    static getDerivedStateFromError(error: Error): State {
        return { error };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo): void {
        console.error('Atlas crashed while rendering', error, info.componentStack);
    }

    render(): React.ReactNode {
        const { error } = this.state;
        if (!error) return this.props.children;

        return (
            <div className="crash" role="alert">
                <p className="crash-title">The interface crashed while drawing.</p>
                <p className="crash-hint">
                    Nothing on disk was touched — a rename only happens when you confirm one. Reload to carry on.
                </p>
                <pre className="crash-detail mono">{error.message}</pre>
                <button type="button" className="button primary" onClick={() => window.location.reload()}>
                    Reload
                </button>
            </div>
        );
    }
}
