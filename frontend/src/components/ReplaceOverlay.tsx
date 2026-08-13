import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MediaItem } from '../api';
import { ReplaceRequest, ReplaceScope, replacementsFor } from '../lib/replace';
import { Kbd } from './Kbd';

/**
 * Ctrl+H. The same correction, on every name at once.
 *
 * It exists because the grid can only fix one cell at a time and the mistakes worth
 * fixing are never in one cell: a series TVDB spells one way and Plex has under
 * another, an accent that came back wrong, a word the capitalisation rule got wrong on
 * a whole season. Twenty-four rows of that is twenty-four identical edits.
 *
 * Three things make it safe enough to point at a Plex library:
 *
 * - **It only writes `Nome proposto`.** Nothing here can touch a title, a year or an
 *   episode number, so nothing here can trigger a re-match and hand a hand-picked
 *   answer back to the scoring.
 * - **It previews before it writes.** The count and the specimens come from the same
 *   pure function the reducer applies, so what is on screen is what will happen — and
 *   the rows are still behind the scrim, where the full names are.
 * - **It undoes in one keystroke.** The reducer applies it as a single transaction.
 *
 * Ctrl+H because that is find-and-replace in every spreadsheet, including the Google
 * Sheet this tool replaced — and because both browsers hand it over: Sheets itself
 * binds it, which is the only proof that matters after `Ctrl+T` and `Ctrl+Shift+G`.
 */

interface ReplaceProps {
    rows: MediaItem[];
    /** The ticked rows — the rename queue, which is also the narrower of the two scopes. */
    selected: ReadonlySet<string>;
    onApply: (request: ReplaceRequest) => void;
    onClose: () => void;
}

/** Enough to recognise what is about to happen; the grid behind the scrim has the rest. */
const PREVIEW_LIMIT = 4;

export const ReplaceOverlay: React.FC<ReplaceProps> = ({ rows, selected, onApply, onClose }) => {
    const [find, setFind] = useState('');
    const [replace, setReplace] = useState('');
    const [matchCase, setMatchCase] = useState(true);
    // Ticking rows is how a batch is chosen everywhere else in this app, so when there is
    // one it is the scope this opens on. The user can still widen it in one click.
    const [scope, setScope] = useState<ReplaceScope>(selected.size > 0 ? 'selected' : 'all');
    const findRef = useRef<HTMLInputElement>(null);

    useEffect(() => findRef.current?.focus(), []);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [onClose]);

    const request: ReplaceRequest = useMemo(
        () => ({ find, replace, matchCase, scope }),
        [find, matchCase, replace, scope]
    );
    const edits = useMemo(() => replacementsFor(rows, selected, request), [request, rows, selected]);

    const apply = () => {
        if (edits.length === 0) return;
        onApply(request);
    };

    const onFieldKeyDown = (event: React.KeyboardEvent) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            apply();
        }
    };

    return (
        <div className="scrim is-top" onMouseDown={onClose}>
            <div
                className="panel replace"
                role="dialog"
                aria-modal="true"
                aria-label="Trova e sostituisci"
                onMouseDown={(event) => event.stopPropagation()}
            >
                <header className="panel-head">
                    <h2>Trova e sostituisci</h2>
                    <button type="button" className="button ghost" onClick={onClose} aria-label="Chiudi">
                        <Kbd chord="escape" />
                    </button>
                </header>

                <div className="panel-body">
                    <div className="replace-fields">
                        <div className="field">
                            <label className="field-label" htmlFor="replace-find">
                                Trova
                            </label>
                            <input
                                id="replace-find"
                                ref={findRef}
                                className="input mono"
                                value={find}
                                spellCheck={false}
                                autoComplete="off"
                                onChange={(event) => setFind(event.target.value)}
                                onKeyDown={onFieldKeyDown}
                            />
                        </div>
                        <div className="field">
                            <label className="field-label" htmlFor="replace-with">
                                Sostituisci con
                            </label>
                            <input
                                id="replace-with"
                                className="input mono"
                                value={replace}
                                spellCheck={false}
                                autoComplete="off"
                                onChange={(event) => setReplace(event.target.value)}
                                onKeyDown={onFieldKeyDown}
                            />
                        </div>
                    </div>

                    <label className="check">
                        <input
                            type="checkbox"
                            checked={matchCase}
                            onChange={(event) => setMatchCase(event.target.checked)}
                        />
                        Distingui maiuscole e minuscole
                    </label>

                    <div className="field">
                        <span className="field-label">Dove</span>
                        {/* The same two-segment control the Type cell uses, at panel size:
                            both answers visible, the live one filled amber. */}
                        <div className="choice replace-scope" role="radiogroup" aria-label="Righe interessate">
                            <button
                                type="button"
                                role="radio"
                                aria-checked={scope === 'all'}
                                className={`choice-option${scope === 'all' ? ' is-on' : ''}`}
                                onClick={() => setScope('all')}
                            >
                                Tutta la tabella
                                <span className="mono">{rows.length}</span>
                            </button>
                            <button
                                type="button"
                                role="radio"
                                aria-checked={scope === 'selected'}
                                className={`choice-option${scope === 'selected' ? ' is-on' : ''}`}
                                disabled={selected.size === 0}
                                onClick={() => setScope('selected')}
                            >
                                Solo le righe spuntate
                                <span className="mono">{selected.size}</span>
                            </button>
                        </div>
                        <span className="field-hint">
                            Riscrive solo la colonna <strong>Nome proposto</strong>: titolo, anno, stagione ed episodio
                            non vengono toccati, quindi nessuna riga viene riabbinata. Il testo è cercato alla lettera,
                            non come espressione regolare. <Kbd chord="mod+z" /> annulla tutto in un colpo solo.
                        </span>
                    </div>

                    <section className="replace-preview">
                        <p className="replace-count">
                            {edits.length === 0
                                ? find === ''
                                    ? 'Scrivi il testo da cercare.'
                                    : `Nessun nome proposto contiene «${find}».`
                                : `${edits.length} ${edits.length === 1 ? 'nome' : 'nomi'} da riscrivere.`}
                        </p>
                        <ul className="replace-list">
                            {edits.slice(0, PREVIEW_LIMIT).map((edit) => (
                                <li key={edit.id}>
                                    <span className="replace-before mono">{edit.before}</span>
                                    <span className="replace-after mono">{edit.after}</span>
                                </li>
                            ))}
                        </ul>
                        {edits.length > PREVIEW_LIMIT && (
                            <p className="field-hint">e altri {edits.length - PREVIEW_LIMIT}, tutti nella griglia.</p>
                        )}
                    </section>
                </div>

                <footer className="panel-foot">
                    <div className="spacer" />
                    <button type="button" className="button ghost" onClick={onClose}>
                        Annulla
                    </button>
                    <button type="button" className="button primary" disabled={edits.length === 0} onClick={apply}>
                        Sostituisci
                        <Kbd chord="enter" />
                    </button>
                </footer>
            </div>
        </div>
    );
};
