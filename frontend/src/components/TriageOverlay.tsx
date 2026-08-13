import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CandidateOut, MediaItem } from '../api';
import { choiceLabel, COLUMNS, columnIndex } from '../lib/columns';
import { percent } from '../lib/format';
import { matchesChord } from '../lib/keymap';
import { sameSeries } from '../lib/series';
import { TYPE_CHORD } from '../lib/shortcuts';
import { Kbd } from './Kbd';

/**
 * Triage: one ambiguity at a time, answered with a digit.
 *
 * The queue is the rows the scoring refused to settle — or, when triage was opened on
 * one row, that row alone. Nothing here is typed, so bare keys are free: 1–9 pick a
 * candidate, which is the fastest possible answer to "which of these is it".
 *
 * It is a window over the grid rather than a screen of its own. Covering everything
 * hid the row being decided and the counts that say how much is left, and a decision
 * about one file out of forty reads better with the forty still behind it.
 *
 * The important part is `applyToSeries`. A season is 10–25 files carrying the exact
 * same ambiguity, and answering "which One Piece?" once has to settle all of them;
 * having to answer it twenty-four more times is what made the previous UI a chore.
 * The replay is free in API terms — the backend caches the raw payloads, so a forced
 * pick by key re-scores from cache rather than searching again.
 *
 * The third field is the absolute episode number, and it is here rather than in the grid
 * because it cannot be resolved without a series: `One Piece - 1015.mkv` is S21E124 only
 * once someone has said *which* One Piece. So it is part of the pick, and it settles one
 * file — an absolute number names exactly one episode, which is why it stands the
 * apply-to-series replay down.
 *
 * The second half is the search. A row the scoring could not place at all — `BrBa`,
 * `all'ombra dell'olmo` — arrives here with an empty list, and used to arrive with
 * nothing to do about it. Searching by hand is the answer, and it has to be the *same*
 * answer: the query re-runs the ordinary analysis with the typed title and year, so what
 * comes back is the ordinary ranked list, and picking from it is the ordinary forced
 * pick. The typed title travels with the pick, because the backend looks the forced key
 * up in the results for the row's own title — leave it behind and the key is not there.
 */

interface TriageProps {
    rows: MediaItem[];
    queue: MediaItem[];
    startId: string | null;
    onPick: (rows: MediaItem[], candidate: CandidateOut, extra?: PickExtras) => void;
    onSearch: (item: MediaItem, title: string, year: number | null) => Promise<CandidateOut[]>;
    onSkip: (item: MediaItem) => void;
    onClose: () => void;
}

export interface TitleOverride {
    clean_title: string;
    year: number | null;
}

/** The two corrections a pick can carry beyond "this is the series". */
export interface PickExtras {
    /** A title and year typed by hand: they replace the row's own before re-matching. */
    override?: TitleOverride;
    /**
     * An absolute episode number. Deliberately *not* written onto the row — only the
     * chosen series knows which season and episode 1015 is, so it travels to the backend
     * as a question and comes back as `season` and `episode` on the answer.
     */
    absolute?: number;
}

const pad2 = (value: number): string => String(value).padStart(2, '0');

const TYPE_SPEC = COLUMNS[columnIndex('media_type')];

/**
 * What the parse made of the filename, as chips.
 *
 * The candidate list answers "which title", but half the wrong matches in practice
 * come from the other half of the question — a season or an episode guessit read
 * differently from the way the file is numbered. Showing the parse next to the
 * candidates is what makes that visible at the moment of deciding.
 */
const facts = (item: MediaItem): { key: string; text: string; tone?: 'warn' }[] => {
    const chips: { key: string; text: string; tone?: 'warn' }[] = [
        {
            key: 'type',
            // Through the column model, so the chip and the Type cell cannot disagree.
            text: item.media_type === 'unknown' ? 'tipo ignoto' : choiceLabel(TYPE_SPEC, item.media_type)
        }
    ];
    if (item.media_type === 'episode') {
        chips.push({ key: 'season', text: item.season == null ? 'nessuna stagione' : `S${pad2(item.season)}` });
        chips.push({ key: 'episode', text: item.episode == null ? 'nessun episodio' : `E${item.episode}` });
    }
    chips.push(
        item.year == null ? { key: 'year', text: 'nessun anno', tone: 'warn' } : { key: 'year', text: `${item.year}` }
    );
    return chips;
};

export const TriageOverlay: React.FC<TriageProps> = ({
    rows,
    queue,
    startId,
    onPick,
    onSearch,
    onSkip,
    onClose
}) => {
    const startIndex = Math.max(
        0,
        queue.findIndex((item) => item.id === startId)
    );
    const [index, setIndex] = useState(startIndex);
    const [applyToSeries, setApplyToSeries] = useState(true);
    const [title, setTitle] = useState('');
    const [year, setYear] = useState('');
    const [absolute, setAbsolute] = useState('');
    const [found, setFound] = useState<CandidateOut[] | null>(null);
    const [searching, setSearching] = useState(false);
    // Which candidate the arrows are on. `1`–`9` are faster and stay, but they only
    // reach nine, and a list is the one place arrow keys are the obvious gesture.
    const [cursor, setCursor] = useState(0);
    const searchBox = useRef<HTMLInputElement>(null);
    const panel = useRef<HTMLDivElement>(null);

    const item = queue[Math.min(index, queue.length - 1)];
    // What the search was run with, so a pick from its results carries the same title
    // the backend will have to search again to find the key.
    const [query, setQuery] = useState<TitleOverride | null>(null);
    // The row's type picks the provider — `enrich_media_item` asks TMDB for a movie and
    // TVDB for an episode — so it is also the filter, and saying which one is being
    // searched is what stops "why is my film not in here" from being a mystery.
    const unknownType = !item || item.media_type === 'unknown';
    const searchScope = item?.media_type === 'movie' ? 'fra i film, su TMDB' : 'fra le serie, su TVDB';
    const candidates = useMemo(() => found ?? item?.candidates ?? [], [found, item]);

    // Walking to another file starts over: last file's results next to this file's name
    // is exactly the confusion this screen exists to prevent.
    useEffect(() => {
        setTitle(item?.clean_title ?? '');
        setYear(item?.year == null ? '' : String(item.year));
        setAbsolute('');
        setFound(null);
        setQuery(null);
        setCursor(0);
    }, [item?.id, item?.clean_title, item?.year]);

    /**
     * Opening has to take the keyboard with it.
     *
     * Reached by chord, this overlay used to appear while the DOM focus stayed on the
     * grid, so the grid kept answering the arrows underneath it. Where the focus goes
     * says what the arrows are for: into the search box when there is nothing to choose
     * from, onto the panel otherwise, where they walk the candidate list.
     */
    useEffect(() => {
        if ((item?.candidates?.length ?? 0) === 0) searchBox.current?.focus();
        else panel.current?.focus();
    }, [item?.id, item?.candidates?.length]);

    const search = useCallback(async () => {
        const wanted = title.trim();
        if (!item || wanted === '' || searching) return;
        const asYear = year.trim() === '' ? null : Number(year.trim());
        const override: TitleOverride = { clean_title: wanted, year: Number.isInteger(asYear) ? asYear : null };
        setSearching(true);
        setFound(await onSearch(item, override.clean_title, override.year));
        setQuery(override);
        setCursor(0);
        setSearching(false);
    }, [item, onSearch, searching, title, year]);

    // An absolute number belongs to one file. Replaying it over a season would file
    // twenty-four episodes as the same one, so it takes the series replay down with it.
    const absoluteNumber = /^\d+$/.test(absolute.trim()) ? Number(absolute.trim()) : null;
    const canApplyToSeries = item?.media_type === 'episode' && absoluteNumber === null;

    // The rows one answer will settle. Movies group to themselves, by design: two
    // films sharing a title are two different films.
    const affected = useMemo(() => {
        if (!item) return [];
        if (!applyToSeries || !canApplyToSeries) return [item];
        return sameSeries(rows, item).filter(
            (row) => row.id === item.id || row.status === 'review' || row.status === 'error' || row.status === 'pending'
        );
    }, [applyToSeries, canApplyToSeries, item, rows]);

    const pick = useCallback(
        (candidate: CandidateOut | undefined) => {
            if (!candidate || !item) return;
            // Only a candidate that came out of a hand-typed search carries the query
            // with it. Picking from the row's own list must not rewrite its title.
            const extra: PickExtras = {};
            if (found && query) extra.override = query;
            if (absoluteNumber !== null) extra.absolute = absoluteNumber;
            // Absent rather than empty: a pick that corrects nothing must be
            // indistinguishable from one made before either field existed.
            onPick(affected, candidate, extra.override || extra.absolute !== undefined ? extra : undefined);
            if (index >= queue.length - 1) onClose();
        },
        [absoluteNumber, affected, found, index, item, onClose, onPick, query, queue.length]
    );

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (matchesChord(event, 'escape')) {
                event.preventDefault();
                onClose();
                return;
            }
            // Bare keys are only free while nothing is being typed. With the cursor in
            // the search box a digit is part of a year and `s` is part of a title, so
            // everything below stands down — the same rule the grid follows for cells.
            if (event.target instanceof HTMLInputElement) return;
            // Vertical walks the candidates, horizontal walks the files. The two used to
            // be one gesture, which meant that on a single-row queue — every `Ctrl+G` —
            // the arrows did nothing at all and the overlay felt inert.
            if (matchesChord(event, 'arrowdown') || matchesChord(event, 'arrowup')) {
                event.preventDefault();
                const step = matchesChord(event, 'arrowdown') ? 1 : -1;
                setCursor((current) => Math.max(0, Math.min(current + step, candidates.length - 1)));
                return;
            }
            if (matchesChord(event, 'enter')) {
                event.preventDefault();
                pick(candidates[cursor]);
                return;
            }
            if (matchesChord(event, 'arrowright') || matchesChord(event, 'arrowleft')) {
                event.preventDefault();
                const step = matchesChord(event, 'arrowright') ? 1 : -1;
                setIndex((current) => Math.max(0, Math.min(current + step, queue.length - 1)));
                return;
            }
            if (matchesChord(event, 'a')) {
                event.preventDefault();
                setApplyToSeries((current) => !current);
                return;
            }
            if (matchesChord(event, 's')) {
                event.preventDefault();
                if (item) onSkip(item);
                setIndex((current) => Math.min(current + 1, queue.length - 1));
                return;
            }
            const digit = Number(event.key);
            if (!event.ctrlKey && !event.metaKey && !event.altKey && Number.isInteger(digit) && digit >= 1 && digit <= 9) {
                event.preventDefault();
                pick(candidates[digit - 1]);
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [candidates, cursor, item, onClose, onSkip, pick, queue.length]);

    if (!item) {
        return (
            <div className="scrim" onMouseDown={onClose}>
                <div
                    className="panel triage"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Triage"
                    onMouseDown={(event) => event.stopPropagation()}
                >
                    <div className="triage-empty">
                        <p>Non è rimasto niente da decidere.</p>
                        <button type="button" className="button" onClick={onClose}>
                            Torna alla griglia
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="scrim" onMouseDown={onClose}>
            <div
                ref={panel}
                className="panel triage"
                role="dialog"
                aria-modal="true"
                aria-label="Triage"
                // Focusable so the arrows have somewhere to arrive: without it they stay
                // with the grid underneath and walk the cursor behind the overlay.
                tabIndex={-1}
                onMouseDown={(event) => event.stopPropagation()}
            >
                <header className="triage-head">
                    <div className="triage-file">
                        <span className="triage-progress mono">
                            Da rivedere {index + 1} di {queue.length}
                        </span>
                        <span className="triage-filename" title={item.original_name}>
                            {item.original_name}
                        </span>
                    </div>
                    <button type="button" className="button ghost" onClick={onClose} aria-label="Torna alla griglia">
                        Torna alla griglia
                        <Kbd chord="escape" />
                    </button>
                </header>

                <div className="triage-facts">
                    {facts(item).map((fact) => (
                        <span key={fact.key} className={`chip mono${fact.tone === 'warn' ? ' is-warn' : ''}`}>
                            {fact.text}
                        </span>
                    ))}
                    {item.message && <span className="triage-message">{item.message}</span>}
                </div>

                {/*
                 * The search. Always here, not only on the rows that came back empty: the
                 * match most in need of correcting is often one the scoring was sure of,
                 * and a candidate list of five wrong answers is no more useful than none.
                 */}
                <form
                    className="triage-search"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void search();
                    }}
                >
                    <input
                        ref={searchBox}
                        className="input"
                        value={title}
                        spellCheck={false}
                        placeholder="Cerca un altro titolo"
                        aria-label="Cerca per titolo"
                        disabled={unknownType}
                        onChange={(event) => setTitle(event.target.value)}
                    />
                    <input
                        className="input mono narrow"
                        value={year}
                        spellCheck={false}
                        inputMode="numeric"
                        placeholder="Anno"
                        aria-label="Anno"
                        disabled={unknownType}
                        onChange={(event) => setYear(event.target.value)}
                    />
                    <button type="submit" className="button" disabled={unknownType || title.trim() === '' || searching}>
                        {searching ? 'Cerco…' : 'Cerca'}
                    </button>
                    <span className="triage-search-scope">
                        {unknownType ? (
                            <>
                                Prima decidi se è un film o un episodio — <Kbd chord={TYPE_CHORD} /> sulla riga
                            </>
                        ) : (
                            searchScope
                        )}
                    </span>
                </form>

                {/*
                 * The absolute number. Only for episodes, and deliberately outside the
                 * search form: it is not a query — it is part of the answer, resolved by
                 * the series the user is about to choose.
                 */}
                {item.media_type === 'episode' && (
                    <div className="triage-absolute">
                        <label className="field-label" htmlFor="absolute-episode">
                            N° assoluto
                        </label>
                        <input
                            id="absolute-episode"
                            className="input mono narrow"
                            value={absolute}
                            spellCheck={false}
                            inputMode="numeric"
                            placeholder="es. 1015"
                            onChange={(event) => setAbsolute(event.target.value)}
                        />
                        <span className="triage-absolute-hint">
                            {absolute.trim() === '' ? (
                                <>Per le serie numerate di seguito: alla scelta diventa stagione ed episodio.</>
                            ) : absoluteNumber === null ? (
                                <span className="is-bad">Serve un numero intero.</span>
                            ) : (
                                <>
                                    <span className="mono">{absoluteNumber}</span> verrà convertito in stagione ed
                                    episodio dalla serie che scegli — e solo su questo file.
                                </>
                            )}
                        </span>
                    </div>
                )}

                {found !== null && (
                    <div className="triage-search-result">
                        <span>
                            {found.length === 0
                                ? 'Nessun risultato'
                                : `${found.length} ${found.length === 1 ? 'risultato' : 'risultati'} per «${query?.clean_title}»`}
                        </span>
                        {(item.candidates?.length ?? 0) > 0 && (
                            <button type="button" className="button ghost tiny" onClick={() => setFound(null)}>
                                Torna ai candidati automatici
                            </button>
                        )}
                    </div>
                )}

                <ol className="candidates">
                    {candidates.map((candidate, position) => (
                        <li key={candidate.key}>
                            <button
                                type="button"
                                className={`candidate${candidate.selected ? ' is-current' : ''}${
                                    position === cursor ? ' is-cursor' : ''
                                }`}
                                onClick={() => pick(candidate)}
                                onMouseEnter={() => setCursor(position)}
                            >
                                <span className="candidate-index mono">{position + 1}</span>
                                {candidate.poster_url ? (
                                    <img className="candidate-poster" src={candidate.poster_url} alt="" loading="lazy" />
                                ) : (
                                    <span className="candidate-poster is-empty" aria-hidden="true" />
                                )}
                                <span className="candidate-body">
                                    <span className="candidate-label">
                                        {candidate.label}
                                        {candidate.year != null && (
                                            <span className="candidate-year mono"> {candidate.year}</span>
                                        )}
                                    </span>
                                    {candidate.overview && <span className="candidate-overview">{candidate.overview}</span>}
                                </span>
                                <span
                                    className="candidate-score"
                                    title={`titolo ${percent(candidate.title_score)} × anno ${candidate.year_factor.toFixed(2)}`}
                                >
                                    <span className="mono">{percent(candidate.score)}</span>
                                    <span className="candidate-bar" aria-hidden="true">
                                        <span style={{ width: percent(candidate.score) }} />
                                    </span>
                                </span>
                            </button>
                        </li>
                    ))}
                    {candidates.length === 0 && (
                        <li className="candidate-none">
                            {found === null
                                ? 'Nessun candidato per questo file: cercalo qui sopra per titolo e anno.'
                                : 'Niente da scegliere. Prova con il titolo originale, o senza anno.'}
                        </li>
                    )}
                </ol>

                <footer className="triage-foot">
                    <label className={`apply-series${canApplyToSeries ? '' : ' is-disabled'}`}>
                        <input
                            type="checkbox"
                            checked={applyToSeries && canApplyToSeries}
                            disabled={!canApplyToSeries}
                            onChange={(event) => setApplyToSeries(event.target.checked)}
                        />
                        <span>
                            Applica a tutta la serie
                            <kbd>A</kbd>
                        </span>
                        <span className="apply-count">
                            {item.media_type !== 'episode'
                                ? 'i film si decidono uno alla volta'
                                : absoluteNumber !== null
                                  ? 'un numero assoluto vale per un file solo'
                                  : `${affected.length} file ${affected.length === 1 ? 'verrà rianalizzato' : 'verranno rianalizzati'}`}
                        </span>
                    </label>
                    <div className="triage-hints">
                        <span>
                            <Kbd chord="arrowup" />
                            <Kbd chord="arrowdown" /> scorri, <kbd>1</kbd>–<kbd>9</kbd> scegli
                        </span>
                        {queue.length > 1 && (
                            <span>
                                <Kbd chord="arrowleft" />
                                <Kbd chord="arrowright" /> altri file
                            </span>
                        )}
                        <span>
                            <kbd>S</kbd> salta
                        </span>
                    </div>
                </footer>
            </div>
        </div>
    );
};
