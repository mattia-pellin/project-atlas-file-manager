import React, { useEffect, useRef } from 'react';
import { MediaItem } from '../api';
import { matchesChord } from '../lib/keymap';
import { Kbd } from './Kbd';

/**
 * The last thing between a decision and the filesystem.
 *
 * The screen is the tally: how many films and how many episodes are about to be
 * rewritten, and the fact that nothing here can be undone. "Forty files" is not a
 * quantity anyone can check, but "two films and thirty-eight episodes" is — it is the
 * one number that can be compared against what the user meant to tick, and it is read
 * at a glance instead of scrolled.
 *
 * It does not list the names. It used to, on the grounds that a wrong name raises no
 * error and the string is the only thing that can be verified — but the grid *is* that
 * list, it is one column wide, it is sorted, it is where the names were read and
 * corrected in the first place, and it is still on screen behind this panel. Printing
 * all forty a second time only pushed the count and the warning off the top.
 */

interface ConfirmProps {
    items: MediaItem[];
    onConfirm: () => void;
    onCancel: () => void;
}

/** Squared, stroked — the same drawing language as the bar's two icons. */
const FILM_ICON = (
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="2.5" y="4.5" width="19" height="15" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M7.6 4.5v15M16.4 4.5v15" stroke="currentColor" strokeWidth="1.5" />
        <path
            d="M4.3 8h1.6M4.3 12h1.6M4.3 16h1.6M18.1 8h1.6M18.1 12h1.6M18.1 16h1.6"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
        />
    </svg>
);

const EPISODE_ICON = (
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="2.5" y="7.5" width="19" height="13" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 3.2l4 4.3 4-4.3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
);

const OTHER_ICON = (
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4.5 20.5V3.5h9l6 6v11z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M13.5 3.5v6h6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
);

const WARNING_ICON = (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <path
            d="M12 3.8 21.2 20H2.8z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
        />
        <path d="M12 9.6v4.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M12 17.1h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
);

/**
 * The tally, by what the row *is* rather than by how it scored.
 *
 * A group with nothing in it is left out entirely: "0 film" is noise on a batch of
 * twenty-four episodes, and the zero is exactly the number nobody needs to read.
 */
const tally = (items: MediaItem[]) =>
    [
        {
            key: 'movie',
            icon: FILM_ICON,
            count: items.filter((item) => item.media_type === 'movie').length,
            one: 'film',
            many: 'film'
        },
        {
            key: 'episode',
            icon: EPISODE_ICON,
            count: items.filter((item) => item.media_type === 'episode').length,
            one: 'episodio',
            many: 'episodi'
        },
        {
            key: 'other',
            icon: OTHER_ICON,
            // Never zero in practice — a row with no type cannot be selected — but
            // counted rather than assumed, so the tiles always add up to the list.
            count: items.filter((item) => item.media_type !== 'movie' && item.media_type !== 'episode').length,
            one: 'altro file',
            many: 'altri file'
        }
    ].filter((group) => group.count > 0);

export const ConfirmRename: React.FC<ConfirmProps> = ({ items, onConfirm, onCancel }) => {
    const confirmRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        confirmRef.current?.focus();
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onCancel();
                return;
            }
            // The chord that opened this dialog also confirms it, so a rename decided
            // from the keyboard never needs the mouse. It is deliberately not bare
            // `Enter`: the confirm button has the focus, so `Enter` already works for
            // anyone who wants it, and a modifier is the right cost for a write to a
            // Plex library. `App.tsx` stands its own `mod+enter` down while this is up.
            if (matchesChord(event, 'mod+enter')) {
                event.preventDefault();
                onConfirm();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [onCancel, onConfirm]);

    // `== null` on purpose: an unscored row arrives as `confidence: null`, and a
    // `=== undefined` test would call it safe.
    const risky = items.filter((item) => item.status === 'review' || item.confidence == null);

    return (
        <div className="scrim" onMouseDown={onCancel}>
            <div
                className="panel confirm"
                role="dialog"
                aria-modal="true"
                aria-label="Conferma la rinomina"
                onMouseDown={(event) => event.stopPropagation()}
            >
                <header className="panel-head">
                    <h2>Rinomina {items.length} file</h2>
                    <button type="button" className="button ghost" onClick={onCancel}>
                        Esc
                    </button>
                </header>

                <div className="confirm-body">
                    <div className="confirm-summary">
                        {tally(items).map((group) => (
                            <div key={group.key} className="confirm-tally">
                                <span className="confirm-tally-icon" aria-hidden="true">
                                    {group.icon}
                                </span>
                                <span className="confirm-tally-text">
                                    <span className="confirm-tally-count mono">{group.count}</span>
                                    <span className="confirm-tally-label">
                                        {group.count === 1 ? group.one : group.many}
                                    </span>
                                </span>
                            </div>
                        ))}
                    </div>

                    {/* Always, not only on a doubtful batch: a confident match renamed onto
                        the wrong path is exactly as permanent as a doubtful one. */}
                    <div className="confirm-warning">
                        <span className="confirm-warning-icon" aria-hidden="true">
                            {WARNING_ICON}
                        </span>
                        <div>
                            {/* A line of its own: it is the verdict, and the sentence under it
                                is the explanation. Run together they read as one long caption. */}
                            <strong className="confirm-warning-title">Non si torna indietro.</strong>
                            <p>
                                I file vengono rinominati sul disco, non so tornare indietro da solo — una volta
                                rinominati, vanno rimessi a posto a mano.
                            </p>
                            {risky.length > 0 && (
                                <p className="confirm-risk">
                                    {risky.length === 1
                                        ? 'Un file non è stato abbinato con sicurezza: '
                                        : `${risky.length} file non sono stati abbinati con sicurezza: `}
                                    controlla il nome proposto nella griglia prima di procedere.
                                </p>
                            )}
                        </div>
                    </div>
                </div>

                <footer className="panel-foot">
                    <div className="spacer" />
                    <button type="button" className="button ghost" onClick={onCancel}>
                        Annulla
                    </button>
                    <button type="button" className="button primary" ref={confirmRef} onClick={onConfirm}>
                        Rinomina
                        <Kbd chord="mod+enter" />
                    </button>
                </footer>
            </div>
        </div>
    );
};
