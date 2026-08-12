import React from 'react';
import { describeChord, formatChord } from '../lib/keymap';
import { SCAN_CHORD, TRIAGE_CHORD } from '../lib/shortcuts';
import { Kbd } from './Kbd';

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
            <span className="brand-name">Project: Atlas</span> <span className="brand-dash">-</span>{' '}
            <span className="brand-suffix">Files</span>
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
                title={`Scan and match (${describeChord(SCAN_CHORD)})`}
            >
                Scan
                <Kbd chord={SCAN_CHORD} />
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
                title={`Triage (${describeChord(TRIAGE_CHORD)})`}
            >
                Triage
                {counts.review + counts.error > 0 && <span className="pip mono">{counts.review + counts.error}</span>}
                <Kbd chord={TRIAGE_CHORD} />
            </button>
            <button
                type="button"
                className="button primary"
                onClick={onRename}
                disabled={busy !== null || counts.selected === 0}
                title={`Rename the selected rows (${describeChord('mod+enter')})`}
            >
                Rename<span className="mono"> {counts.selected}</span>
                <Kbd chord="mod+enter" />
            </button>
            <button type="button" className="icon-button" onClick={onSettings} aria-label="Settings" title={formatChord('mod+,')}>
                {/* A cogwheel: eight teeth, every coordinate on a circle about (12,12) —
                    tips at r=10.5, roots at r=7.3, 45° apart. The path this replaces was
                    drawn by hand and its teeth were neither the same size nor evenly
                    spaced, which is what made the icon look bent. */}
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                        d="M10.11 4.95L10.00 1.69L14.00 1.69L13.89 4.95A7.3 7.3 0 0 1 15.65 5.68L17.87 3.30L20.70 6.13L18.32 8.35A7.3 7.3 0 0 1 19.05 10.11L22.31 10.00L22.31 14.00L19.05 13.89A7.3 7.3 0 0 1 18.32 15.65L20.70 17.87L17.87 20.70L15.65 18.32A7.3 7.3 0 0 1 13.89 19.05L14.00 22.31L10.00 22.31L10.11 19.05A7.3 7.3 0 0 1 8.35 18.32L6.13 20.70L3.30 17.87L5.68 15.65A7.3 7.3 0 0 1 4.95 13.89L1.69 14.00L1.69 10.00L4.95 10.11A7.3 7.3 0 0 1 5.68 8.35L3.30 6.13L6.13 3.30L8.35 5.68A7.3 7.3 0 0 1 10.11 4.95Z"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinejoin="round"
                    />
                    <circle cx="12" cy="12" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
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
