import React from 'react';
import { Chord, formatChord } from '../lib/keymap';
import { Counts } from './CommandBar';

/**
 * The single-line footer from design C: counts on the left, the keys that work
 * *right now* in the middle, the directory on the right.
 *
 * The middle is the point. A keyboard-first tool that only documents itself behind
 * Ctrl+/ is a keyboard-first tool nobody learns; the footer keeps the four or five
 * keys that matter in the current mode permanently in view, and they are rendered
 * from the same chord strings the handlers match on, so the footer cannot advertise
 * a key that does nothing.
 */

export type Mode = 'grid' | 'triage' | 'settings' | 'keymap' | 'palette' | 'confirm';

interface Hint {
    chord: Chord;
    what: string;
}

const HINTS: Record<Mode, Hint[]> = {
    grid: [
        { chord: 'enter', what: 'edit' },
        { chord: 'space', what: 'tick' },
        { chord: 'mod+d', what: 'fill down' },
        { chord: 'mod+t', what: 'triage' },
        { chord: 'mod+enter', what: 'rename' },
        { chord: 'mod+k', what: 'commands' }
    ],
    triage: [
        { chord: '1', what: 'choose (1–9)' },
        { chord: 'a', what: 'whole series' },
        { chord: 's', what: 'skip' },
        { chord: 'escape', what: 'grid' }
    ],
    settings: [{ chord: 'escape', what: 'back to the grid' }],
    keymap: [{ chord: 'escape', what: 'back to the grid' }],
    palette: [
        { chord: 'arrowdown', what: 'move' },
        { chord: 'enter', what: 'run' },
        { chord: 'escape', what: 'close' }
    ],
    confirm: [
        { chord: 'enter', what: 'rename' },
        { chord: 'escape', what: 'cancel' }
    ]
};

interface StatusBarProps {
    counts: Counts;
    directory: string;
    mode: Mode;
}

export const StatusBar: React.FC<StatusBarProps> = ({ counts, directory, mode }) => (
    <footer className="status">
        {/* Each count is one text node, not a number next to a word: split across two
            nodes it renders as "3<!-- -->files" in any server-rendered snapshot, which
            is a nuisance to assert on and a nuisance for a screen reader to read. */}
        <span className="status-counts mono">
            <span>{`${counts.total} files`}</span>
            <Separator />
            <span className={counts.selected > 0 ? 'is-selected' : ''}>{`${counts.selected} selected`}</span>
            <Separator />
            <span className="is-matched">{`${counts.matched} matched`}</span>
            <Separator />
            <span className={counts.review > 0 ? 'is-review' : ''}>{`${counts.review} review`}</span>
            <Separator />
            <span className={counts.error > 0 ? 'is-error' : ''}>{`${counts.error} unmatched`}</span>
        </span>

        <span className="status-rule" aria-hidden="true" />

        <span className="status-hints">
            {HINTS[mode].map((hint) => (
                <span key={hint.chord} className="status-hint">
                    <kbd>{formatChord(hint.chord)}</kbd>
                    <span>{hint.what}</span>
                </span>
            ))}
        </span>

        <span className="status-path mono" title={directory}>
            {directory}
        </span>
    </footer>
);

const Separator: React.FC = () => (
    <span className="status-sep" aria-hidden="true">
        ·
    </span>
);
