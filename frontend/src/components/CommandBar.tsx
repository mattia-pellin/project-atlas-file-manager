import React from 'react';
import { formatChord } from '../lib/keymap';

/**
 * One line at the top of the screen, and nothing else.
 *
 * Design C has no sidebar, so this bar carries the whole chrome: where to scan, what
 * state the batch is in, and the two irreversible-ish actions. Everything rarer lives
 * behind Ctrl+K, which is why the bar can stay this thin.
 */

export interface Counts {
    total: number;
    matched: number;
    review: number;
    error: number;
    selected: number;
}

interface CommandBarProps {
    directory: string;
    onDirectoryChange: (directory: string) => void;
    busy: string | null;
    counts: Counts;
    onScan: () => void;
    onTriage: () => void;
    onRename: () => void;
    onSettings: () => void;
    onKeymap: () => void;
}

export const CommandBar: React.FC<CommandBarProps> = ({
    directory,
    onDirectoryChange,
    busy,
    counts,
    onScan,
    onTriage,
    onRename,
    onSettings,
    onKeymap
}) => (
    <header className="bar">
        <span className="brand">
            atlas<span className="brand-dot" aria-hidden="true" />
        </span>

        <form
            className="bar-path"
            onSubmit={(event) => {
                event.preventDefault();
                onScan();
            }}
        >
            <input
                className="input mono"
                value={directory}
                spellCheck={false}
                aria-label="Directory to scan"
                onChange={(event) => onDirectoryChange(event.target.value)}
            />
            <button type="submit" className="button" disabled={busy !== null} title={`Scan and match (${formatChord('mod+r')})`}>
                Scan
            </button>
        </form>

        <div className="bar-counts" aria-live="polite">
            {busy ? (
                <span className="busy">{busy}</span>
            ) : (
                <>
                    <span className="count">
                        <span className="mono">{counts.total}</span> files
                    </span>
                    <span className="count is-matched">
                        <span className="mono">{counts.matched}</span> matched
                    </span>
                    <span className="count is-review">
                        <span className="mono">{counts.review}</span> to review
                    </span>
                    {counts.error > 0 && (
                        <span className="count is-error">
                            <span className="mono">{counts.error}</span> unmatched
                        </span>
                    )}
                </>
            )}
        </div>

        <div className="bar-actions">
            <button
                type="button"
                className="button ghost"
                onClick={onTriage}
                disabled={busy !== null || counts.review + counts.error === 0}
                title={`Triage (${formatChord('mod+t')})`}
            >
                Triage
                {counts.review + counts.error > 0 && <span className="pip mono">{counts.review + counts.error}</span>}
            </button>
            <button
                type="button"
                className="button primary"
                onClick={onRename}
                disabled={busy !== null || counts.selected === 0}
                title={`Rename the selected rows (${formatChord('mod+enter')})`}
            >
                Rename<span className="mono"> {counts.selected}</span>
            </button>
            <button type="button" className="icon-button" onClick={onSettings} aria-label="Settings" title={formatChord('mod+,')}>
                <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true">
                    <circle cx="7.5" cy="7.5" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
                    <path
                        d="M7.5 1.4v1.8M7.5 11.8v1.8M1.4 7.5h1.8M11.8 7.5h1.8M3.2 3.2l1.3 1.3M10.5 10.5l1.3 1.3M11.8 3.2l-1.3 1.3M4.5 10.5l-1.3 1.3"
                        stroke="currentColor"
                        strokeWidth="1.3"
                        strokeLinecap="round"
                    />
                </svg>
            </button>
            <button type="button" className="icon-button" onClick={onKeymap} aria-label="Keyboard shortcuts" title={formatChord('mod+/')}>
                <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true">
                    <rect x="1" y="3.5" width="13" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" />
                    <path d="M3.6 6.2h.8M6.1 6.2h.8M8.6 6.2h.8M11.1 6.2h.8M4.6 8.8h5.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
            </button>
        </div>
    </header>
);
