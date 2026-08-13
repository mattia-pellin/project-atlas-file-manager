import React, { useEffect } from 'react';
import { percent } from '../lib/format';
import { formatChord } from '../lib/keymap';
import { TRIAGE_ROW_CHORD } from '../lib/shortcuts';

/**
 * What the C.S. column means, in front of the number it explains.
 *
 * The score is the one value in the grid that is not a fact about the file: every other
 * column is either what is on disk or what the name will be, whereas this is the app
 * reporting how much it trusts itself. Two things about it are counter-intuitive enough
 * that a user is entitled to an explanation — a perfect title can score 50% because a
 * second candidate matched just as well, and a 100% can still be wrong — and neither
 * fits in a tooltip.
 *
 * The thresholds come in as props rather than being written here, so the bands described
 * are the ones actually in force rather than the defaults.
 */

interface ConfidenceOverlayProps {
    review: number;
    match: number;
    onClose: () => void;
}

export const ConfidenceOverlay: React.FC<ConfidenceOverlayProps> = ({ review, match, onClose }) => {
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [onClose]);

    return (
        <div className="scrim" onMouseDown={onClose}>
            <div
                className="panel confidence-help"
                role="dialog"
                aria-modal="true"
                aria-label="Confidence score"
                onMouseDown={(event) => event.stopPropagation()}
            >
                <header className="panel-head">
                    <h2>C.S. — Confidence Score</h2>
                    <button type="button" className="button ghost" onClick={onClose}>
                        Esc
                    </button>
                </header>

                <div className="panel-body">
                    <p className="help-lead">
                        Quanto l’app è sicura che questo file corrisponda al risultato API da cui ha preso il nome. Non
                        dice nulla su come il nome è scritto — solo se il titolo è quello giusto.
                    </p>

                    <section className="field-group">
                        <h3>Come viene calcolato</h3>
                        <dl className="help-list">
                            <div>
                                <dt>Titolo</dt>
                                <dd>
                                    Il nome del file contro ogni nome con cui il candidato è conosciuto — titolo
                                    originale, alias e traduzioni — confrontati senza accenti e senza punteggiatura.{' '}
                                    {/*
                                     * Inline, like a backtick in a chat: only the specimen is
                                     * boxed. The two scripts are the argument the sentence is
                                     * making, so lifting them into a block of their own broke it.
                                     */}
                                    <span className="help-example">One Piece → ワンピース</span> è l’unico modo per
                                    raggiungere un anime il cui nome principale non è scritto nell’alfabeto latino.
                                </dd>
                            </div>
                            <div>
                                <dt>Anno</dt>
                                <dd>
                                    Moltiplica quel punteggio invece di ritoccarlo, così un disaccordo ridimensiona
                                    anche un titolo perfetto: due anni di scarto costano all’incirca la metà.
                                </dd>
                            </div>
                            <div>
                                <dt>Secondo classificato</dt>
                                <dd>
                                    Il risultato viene poi smorzato da quanto è vicino il secondo candidato. È la parte
                                    che sorprende: essere sicuri del <em>titolo</em> non è essere sicuri della{' '}
                                    <em>serie</em>, quindi due programmi chiamati entrambi <em>Doctor Who</em> si
                                    annullano a vicenda per quanto bene corrispondano presi da soli. Un pareggio
                                    dimezza il punteggio.
                                </dd>
                            </div>
                        </dl>
                    </section>

                    <section className="field-group">
                        <h3>Che cosa comporta il punteggio</h3>
                        <ul className="help-bands">
                            <li>
                                <span className="help-swatch is-match" aria-hidden="true" />
                                <strong className="mono">≥ {percent(match)}</strong>
                                <span>abbinato, e spuntato per la rinomina senza chiedere</span>
                            </li>
                            <li>
                                <span className="help-swatch is-review" aria-hidden="true" />
                                <strong className="mono">
                                    {percent(review)} – {percent(match)}
                                </strong>
                                <span>un nome viene proposto, ma la riga la spunti tu</span>
                            </li>
                            <li>
                                <span className="help-swatch is-error" aria-hidden="true" />
                                <strong className="mono">&lt; {percent(review)}</strong>
                                <span>nessun nome, e il motivo è sulla riga</span>
                            </li>
                        </ul>
                    </section>

                    <p className="help-warning">
                        Un punteggio alto non è una garanzia.{' '}
                        <span className="help-example">One Piece - 1015.mkv</span> segna 100% ed è sbagliato: il numero
                        di episodio assoluto è stato letto male <em>prima</em> che l’API venisse interrogata, quindi
                        tutto il resto si è trovato d’accordo sull’episodio sbagliato. Quando il nome sembra sbagliato, non è con il punteggio che bisogna discutere: premi{' '}
                        <kbd>{formatChord(TRIAGE_ROW_CHORD)}</kbd> e scegli l’abbinamento a mano, oppure correggi le
                        celle e la riga si riabbina da sola.
                    </p>
                </div>
            </div>
        </div>
    );
};
