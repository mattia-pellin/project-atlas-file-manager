import React from 'react';
import { formatChord } from '../lib/keymap';
import { SCAN_CHORDS } from '../lib/shortcuts';

/**
 * One line at the top of the screen, and nothing else.
 *
 * Design C has no sidebar, so this bar carries where to scan, the progress of
 * whatever is running, and the two irreversible-ish actions. The counts live in the
 * status bar at the foot of the screen, next to the keys for the current mode — the
 * batch's state and the way to act on it read better together than split across two
 * ends of the window. Everything rarer lives behind Ctrl+K.
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
            <span className="brand-dot" aria-hidden="true" />
            <span className="brand-prefix">Project:</span> Atlas <span className="brand-dash">-</span> Files
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
            <button
                type="submit"
                className="button"
                disabled={busy !== null}
                title={`Scan and match (${formatChord(SCAN_CHORDS[0])})`}
            >
                Scan<kbd>{formatChord(SCAN_CHORDS[0])}</kbd>
            </button>
        </form>

        <div className="bar-busy" aria-live="polite">
            {busy && <span className="busy mono">{busy}</span>}
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
                <kbd>{formatChord('mod+t')}</kbd>
            </button>
            <button
                type="button"
                className="button primary"
                onClick={onRename}
                disabled={busy !== null || counts.selected === 0}
                title={`Rename the selected rows (${formatChord('mod+enter')})`}
            >
                Rename<span className="mono"> {counts.selected}</span>
                <kbd>{formatChord('mod+enter')}</kbd>
            </button>
            <button type="button" className="icon-button" onClick={onSettings} aria-label="Settings" title={formatChord('mod+,')}>
                {/* A cogwheel: eight square teeth on a ring. The spoked circle that was
                    here read as a sun, which is not what a settings control looks like. */}
                <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                        d="M12 2.4l1.5.28.55 2.05a7.6 7.6 0 011.9 1.1l2-.68 1.05 1.3-1.2 1.72c.24.65.4 1.33.46 2.05l1.9.98v1.6l-1.9.98a7.6 7.6 0 01-.46 2.05l1.2 1.72-1.05 1.3-2-.68a7.6 7.6 0 01-1.9 1.1l-.55 2.05-1.5.28-1.5-.28-.55-2.05a7.6 7.6 0 01-1.9-1.1l-2 .68-1.05-1.3 1.2-1.72a7.6 7.6 0 01-.46-2.05l-1.9-.98v-1.6l1.9-.98c.06-.72.22-1.4.46-2.05L4.5 5.15 5.55 3.85l2 .68a7.6 7.6 0 011.9-1.1l.55-2.05z"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinejoin="round"
                    />
                    <circle cx="12" cy="12" r="3.1" fill="none" stroke="currentColor" strokeWidth="1.5" />
                </svg>
            </button>
            <button type="button" className="icon-button" onClick={onKeymap} aria-label="Keyboard shortcuts" title={formatChord('mod+/')}>
                <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="1.6" y="5.6" width="20.8" height="12.8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
                    <path
                        d="M5.8 9.9h1.3M9.6 9.9h1.3M13.4 9.9h1.3M17.2 9.9h1.3M7.4 14.1h9.2"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                    />
                </svg>
            </button>
        </div>
    </header>
);
