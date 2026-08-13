import React from 'react';
import { Chord } from '../lib/keymap';
import { TRIAGE_CHORD, TRIAGE_ROW_CHORD } from '../lib/shortcuts';
import { Counts } from './CommandBar';
import { Kbd } from './Kbd';

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

export type Mode = 'grid' | 'triage' | 'settings' | 'keymap' | 'palette' | 'confirm' | 'confidence' | 'about';

interface Hint {
    chord: Chord;
    what: string;
}

const HINTS: Record<Mode, Hint[]> = {
    grid: [
        { chord: 'enter', what: 'modifica' },
        { chord: 'space', what: 'spunta' },
        { chord: 'mod+d', what: 'ricopia' },
        { chord: TRIAGE_ROW_CHORD, what: 'triage riga' },
        { chord: TRIAGE_CHORD, what: 'triage completo' },
        { chord: 'mod+enter', what: 'rinomina' },
        { chord: 'mod+k', what: 'comandi' }
    ],
    triage: [
        { chord: '1', what: 'scegli (1–9)' },
        { chord: 'a', what: 'tutta la serie' },
        { chord: 's', what: 'salta' },
        { chord: 'escape', what: 'griglia' }
    ],
    settings: [{ chord: 'escape', what: 'torna alla griglia' }],
    keymap: [{ chord: 'escape', what: 'torna alla griglia' }],
    confidence: [{ chord: 'escape', what: 'torna alla griglia' }],
    about: [{ chord: 'escape', what: 'torna alla griglia' }],
    palette: [
        { chord: 'arrowdown', what: 'sposta' },
        { chord: 'enter', what: 'esegui' },
        { chord: 'escape', what: 'chiudi' }
    ],
    confirm: [
        { chord: 'enter', what: 'rinomina' },
        { chord: 'escape', what: 'annulla' }
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
            <span>{`${counts.total} file`}</span>
            <Separator />
            <span className={counts.selected > 0 ? 'is-selected' : ''}>{`${counts.selected} selezionati`}</span>
            <Separator />
            <span className="is-matched">{`${counts.matched} abbinati`}</span>
            <Separator />
            <span className={counts.review > 0 ? 'is-review' : ''}>{`${counts.review} da rivedere`}</span>
            <Separator />
            <span className={counts.error > 0 ? 'is-error' : ''}>{`${counts.error} non abbinati`}</span>
        </span>

        <span className="status-rule" aria-hidden="true" />

        <span className="status-hints">
            {HINTS[mode].map((hint) => (
                <span key={hint.chord} className="status-hint">
                    <Kbd chord={hint.chord} />
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
