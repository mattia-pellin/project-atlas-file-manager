import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
    analyzeItem,
    AppConfig,
    CandidateOut,
    clearCache,
    getConfig,
    MediaItem,
    renameItems,
    scanDirectory,
    searchCandidates
} from './api';
import { AboutOverlay } from './components/AboutOverlay';
import { Busy, CommandBar, Counts } from './components/CommandBar';
import { Command, CommandPalette } from './components/CommandPalette';
import { ConfidenceOverlay } from './components/ConfidenceOverlay';
import { ConfirmRename } from './components/ConfirmRename';
import { Grid } from './components/Grid';
import { KeymapOverlay } from './components/KeymapOverlay';
import { SettingsPanel } from './components/SettingsPanel';
import { Mode, StatusBar } from './components/StatusBar';
import { Toast, Toasts } from './components/Toasts';
import { PickExtras, TriageOverlay } from './components/TriageOverlay';
import { columnIndex } from './lib/columns';
import { gridReducer, initialGridState } from './lib/gridReducer';
import { formatChord, matchesChord } from './lib/keymap';
import { runPool } from './lib/pool';
import { needsTriage } from './lib/series';
import { SCAN_CHORD, TRIAGE_CHORD, TRIAGE_ROW_CHORD, TYPE_CHORD } from './lib/shortcuts';
import { hasStoredSettings, readStoredSettings, saveSettings, Settings, settingsFromConfig } from './lib/settings';
import './styles/app.css';

/**
 * The shell.
 *
 * It owns the network and the modes; the grid owns the keyboard and the reducer owns
 * the data. Nothing here decides what a key does — that lives in `gridReducer`, which
 * is testable without a DOM.
 */

const App: React.FC = () => {
    const [state, dispatch] = useReducer(gridReducer, undefined, () => initialGridState([]));
    const [settings, setSettings] = useState<Settings>(() => readStoredSettings());
    const [config, setConfig] = useState<AppConfig | null>(null);
    const [mode, setMode] = useState<Mode>('grid');
    const [triageStart, setTriageStart] = useState<string | null>(null);
    // null means "the unsettled queue"; a list means triage was opened on those rows,
    // which is how one row gets decided without walking through everything else.
    const [triageIds, setTriageIds] = useState<string[] | null>(null);
    // Whatever is running, and which of the bar's three verbs is reporting it. Every
    // path that sets it must clear it, or that verb stays disabled for the session.
    const [busy, setBusy] = useState<Busy | null>(null);
    const [toasts, setToasts] = useState<Toast[]>([]);
    const toastSeq = useRef(0);
    const gridRef = useRef<HTMLDivElement>(null);

    const say = useCallback((text: string, tone: Toast['tone'] = 'info') => {
        toastSeq.current += 1;
        setToasts((current) => [...current, { id: `t${toastSeq.current}`, text, tone }]);
    }, []);

    const dismiss = useCallback((id: string) => setToasts((current) => current.filter((toast) => toast.id !== id)), []);

    // The reducer reports what it refused to do; the shell is where that becomes visible.
    useEffect(() => {
        if (state.notice) {
            say(state.notice);
            dispatch({ type: 'dismissNotice' });
        }
    }, [say, state.notice]);

    // The server's defaults apply only to a browser that has never saved any: once the
    // user has chosen a threshold, a reload must not quietly take it back.
    useEffect(() => {
        getConfig()
            .then((loaded) => {
                setConfig(loaded);
                if (!hasStoredSettings()) setSettings((current) => ({ ...current, ...settingsFromConfig(loaded) }));
                if (!loaded.tmdb_configured || !loaded.tvdb_configured) {
                    say('Manca la chiave TMDB o TVDB — finché non è configurata nessuna riga verrà abbinata', 'error');
                }
            })
            .catch((error: Error) => say(error.message, 'error'));
    }, [say]);

    const applySettings = useCallback((next: Settings) => {
        setSettings(next);
        saveSettings(next);
        setMode('grid');
    }, []);

    const analyzeOptions = useMemo(
        () => ({
            languages: settings.languages,
            matchThreshold: settings.matchThreshold,
            reviewThreshold: settings.reviewThreshold
        }),
        [settings.languages, settings.matchThreshold, settings.reviewThreshold]
    );

    /** One request per file, capped, with each row filling in as its answer lands. */
    const analyzeAll = useCallback(
        async (
            items: MediaItem[],
            forcedKey: string | undefined,
            task: { label: string; detail?: string },
            absoluteEpisode?: number
        ): Promise<MediaItem[]> => {
            let done = 0;
            // On the scan button: this is the half of "scansiona e abbina" that is
            // running, and a rescan on top of it is exactly what must not happen.
            const progress = { verb: 'scan' as const, ...task, total: items.length };
            setBusy({ ...progress, done: 0 });
            const results = await runPool(
                items,
                settings.analyzeConcurrency,
                async (item) => {
                    // The dot turns on the rows actually in flight, not on all forty.
                    // `item` itself is left untouched and is what goes on the wire — the
                    // backend has no `analyzing` state and must never be told about one.
                    dispatch({ type: 'mergeRows', rows: [{ ...item, status: 'analyzing' as const }] });
                    try {
                        return await analyzeItem(item, { ...analyzeOptions, forcedKey, absoluteEpisode });
                    } catch (error) {
                        return { ...item, status: 'error' as const, message: (error as Error).message };
                    }
                },
                (result) => {
                    done += 1;
                    setBusy({ ...progress, done });
                    dispatch({ type: 'mergeRows', rows: [result] });
                }
            );
            // Deliberately no `sort` here. Analysis rewrites the very fields the order is
            // built from, and a cell edit re-analyses that one row — so sorting on the way
            // out moved the row out from under the cursor that had just typed into it. A
            // fresh scan sorts once, in `analyze`; after that the order is asked for, from
            // the button in the status header.
            setBusy(null);
            return results;
        },
        [analyzeOptions, settings.analyzeConcurrency]
    );

    /**
     * A cell edit invalidates the proposal that was derived from it, so the row
     * re-matches itself — that, and triage, are the only two ways a match changes.
     *
     * There is deliberately no "match everything again" command. It would re-derive
     * rows the user had already settled by hand and hand them back to the scoring,
     * silently replacing a chosen answer with a guess. Re-reading the directory is a
     * rescan, which starts from nothing and is honest about it.
     */
    useEffect(() => {
        if (state.staleRowIds.length === 0) return;
        const stale = new Set(state.staleRowIds);
        dispatch({ type: 'clearStale' });
        const items = state.rows.filter((row) => stale.has(row.id));
        if (items.length > 0) void analyzeAll(items, undefined, { label: 'Riabbino' });
    }, [analyzeAll, state.rows, state.staleRowIds]);

    const analyze = useCallback(
        async (items: MediaItem[]) => {
            if (items.length === 0) return;
            const analyzed = await analyzeAll(items, undefined, { label: 'Analisi' });
            // The one automatic reorder: a scan has just replaced every row, so there is no
            // cursor position and nothing typed for the new order to pull out from under.
            dispatch({ type: 'sort' });

            // Ticking the confident rows is not optional: it is what the match threshold
            // *means*, and a switch that turned it off left the threshold describing a
            // behaviour the app was not performing. Move the threshold instead.
            const confident = analyzed.filter((item) => item.status === 'matched').map((item) => item.id);
            if (confident.length > 0) dispatch({ type: 'setSelection', ids: confident });

            const unsettled = analyzed.filter((item) => item.status === 'review' || item.status === 'error').length;
            if (unsettled > 0) say(`${unsettled} file da abbinare — ${formatChord(TRIAGE_CHORD)} per il triage`);
        },
        [analyzeAll, say]
    );

    const scan = useCallback(async () => {
        setBusy({ verb: 'scan', label: 'Scansione…' });
        let found: MediaItem[];
        try {
            found = await scanDirectory(settings.directory, settings.languages);
        } catch (error) {
            setBusy(null);
            say((error as Error).message, 'error');
            return;
        }
        dispatch({ type: 'setRows', rows: found });
        setBusy(null);
        // A scan always matches what it found. Splitting the two would leave rows with
        // no proposal and, since the bulk re-match is gone, no way to get one.
        if (found.length === 0) say('Nessun file multimediale in quella cartella');
        else await analyze(found);
    }, [analyze, say, settings.directory, settings.languages]);

    /**
     * A hand-picked candidate, replayed over every file it settles.
     *
     * The pick travels as `forced_key`, not as a finished name: the backend still
     * builds the title, the padding and the episode titles, so one decision across a
     * season cannot produce twenty-four subtly different conventions. It costs no
     * extra API calls either — the raw payloads are already cached, so this re-scores
     * rather than re-searches.
     */
    const applyPick = useCallback(
        async (items: MediaItem[], candidate: CandidateOut, extra?: PickExtras) => {
            // A pick made from a hand-typed search has to carry that title onto the rows.
            // The backend resolves `forced_key` inside the results for the row's *own*
            // title, so a key found under "Breaking Bad" is simply absent from the results
            // for "BrBa" — and an absent forced key is a refusal, by design.
            const targets = extra?.override ? items.map((item) => ({ ...item, ...extra.override })) : items;
            // The absolute number, on the other hand, is not written onto the row: only
            // the chosen series can say which season and episode it is, so it goes to the
            // backend as a question and comes back as the answer.
            await analyzeAll(targets, candidate.key, { label: 'Applico', detail: `Applico ${candidate.label}` }, extra?.absolute);
            say(`${candidate.label} applicato a ${items.length} file`);
        },
        [analyzeAll, say]
    );

    /** A search by hand from triage: the ordinary analysis, run on a title the user typed. */
    const searchByHand = useCallback(
        async (item: MediaItem, title: string, year: number | null): Promise<CandidateOut[]> => {
            setBusy({ verb: 'triage', label: 'Cerco…', detail: `Cerco ${title}` });
            try {
                return await searchCandidates(item, title, year, analyzeOptions);
            } catch (error) {
                say((error as Error).message, 'error');
                return [];
            } finally {
                setBusy(null);
            }
        },
        [analyzeOptions, say]
    );

    const selectedItems = useMemo(
        () => state.rows.filter((row) => state.selected.has(row.id)),
        [state.rows, state.selected]
    );

    const rename = useCallback(async () => {
        if (selectedItems.length === 0) return;
        setMode('grid');
        setBusy({ verb: 'rename', label: 'Rinomino', total: selectedItems.length, done: 0 });
        dispatch({ type: 'mergeRows', rows: selectedItems.map((item) => ({ ...item, status: 'renaming' as const })) });
        try {
            const results = await renameItems(selectedItems);
            dispatch({ type: 'mergeRows', rows: results });
            const failed = results.filter((item) => item.status === 'error');
            const renamed = results.length - failed.length;
            if (renamed > 0) say(`${renamed} file rinominati`);
            if (failed.length > 0) say(`${failed.length} file non rinominati — il motivo è sulla riga`, 'error');
            // Only the failures stay ticked, so a second attempt cannot re-rename a file
            // that already moved.
            dispatch({ type: 'setSelection', ids: failed.map((item) => item.id) });
        } catch (error) {
            dispatch({ type: 'mergeRows', rows: selectedItems });
            say((error as Error).message, 'error');
        }
        setBusy(null);
    }, [say, selectedItems]);

    const emptyCache = useCallback(async () => {
        try {
            const { cleared } = await clearCache();
            say(`Cache svuotata — ${cleared} ${cleared === 1 ? 'voce eliminata' : 'voci eliminate'}`);
            const refreshed = await getConfig().catch(() => null);
            if (refreshed) setConfig(refreshed);
        } catch (error) {
            say((error as Error).message, 'error');
        }
    }, [say]);

    const copyCell = useCallback(
        (text: string) => {
            navigator.clipboard?.writeText(text).catch(() => say('Il browser ha rifiutato gli appunti', 'error'));
        },
        [say]
    );

    /** Writes the clipboard down the whole vertical selection, not just the focused cell. */
    const pasteCell = useCallback(async () => {
        try {
            const text = await navigator.clipboard.readText();
            dispatch({ type: 'pasteCell', text });
        } catch {
            say('Il browser ha rifiutato gli appunti — incolla dentro la cella in modifica', 'error');
        }
    }, [say]);

    const queue = useMemo(() => needsTriage(state.rows), [state.rows]);

    /** What triage is looking at: the whole unsettled queue, or the rows it was opened on. */
    const triageQueue = useMemo(() => {
        if (triageIds === null) return queue;
        const wanted = new Set(triageIds);
        return state.rows.filter((row) => wanted.has(row.id));
    }, [queue, state.rows, triageIds]);

    /**
     * Triage one row, whatever the scoring made of it.
     *
     * The queue only holds what the scoring *admitted* it could not settle, and the
     * match that most needs correcting is often the one it was sure of — a confident
     * 1.00 on the wrong series looks identical to a right one until you read the name.
     * So this ignores status entirely and asks only whether there is anything to choose
     * between.
     */
    const openTriageRow = useCallback(
        (rowId: string | null) => {
            const row = rowId === null ? undefined : state.rows.find((candidate) => candidate.id === rowId);
            if (!row) {
                say('Nessuna riga selezionata');
                return;
            }
            // A row with no candidates is not turned away any more: triage opens on its
            // search box, which is the only thing left that can place the file. A row that
            // has not been analyzed yet is a different matter — there is nothing to correct.
            if (row.status === 'pending' || row.status === 'analyzing' || row.status === 'renaming') {
                say(`${row.original_name} non è ancora stato analizzato`);
                return;
            }
            setTriageIds([row.id]);
            setTriageStart(row.id);
            setMode('triage');
        },
        [say, state.rows]
    );

    const openTriage = useCallback(
        (rowId: string | null) => {
            // Opened on a row that the scoring did settle: that row alone, since it is
            // not in the queue and there is nothing to walk through from it.
            if (rowId !== null && !queue.some((row) => row.id === rowId)) {
                openTriageRow(rowId);
                return;
            }
            if (queue.length === 0) {
                say('Niente da mettere in triage');
                return;
            }
            setTriageIds(null);
            setTriageStart(rowId);
            setMode('triage');
        },
        [openTriageRow, queue, say]
    );

    const counts: Counts = useMemo(
        () => ({
            total: state.rows.length,
            matched: state.rows.filter((row) => row.status === 'matched').length,
            review: state.rows.filter((row) => row.status === 'review').length,
            error: state.rows.filter((row) => row.status === 'error').length,
            selected: state.selected.size
        }),
        [state.rows, state.selected]
    );

    const commands: Command[] = useMemo(
        () => [
            {
                id: 'scan',
                label: 'Riscansiona la cartella e riabbina tutto',
                chord: SCAN_CHORD,
                run: () => void scan()
            },
            {
                id: 'triage',
                label: 'Triage dei file non risolti',
                chord: TRIAGE_CHORD,
                run: () => openTriage(null),
                disabled: queue.length === 0
            },
            {
                id: 'triage-row',
                label: 'Triage di questa riga — scegli l’abbinamento a mano',
                chord: TRIAGE_ROW_CHORD,
                run: () => openTriageRow(state.focusRowId),
                disabled: state.focusRowId === null
            },
            {
                id: 'rename',
                label: `Rinomina i ${counts.selected} file selezionati`,
                chord: 'mod+enter',
                run: () => setMode('confirm'),
                disabled: counts.selected === 0
            },
            {
                id: 'sort',
                label: 'Riordina la tabella',
                run: () => dispatch({ type: 'sort' }),
                disabled: state.rows.length === 0
            },
            {
                id: 'select-matched',
                label: 'Spunta ogni abbinamento sicuro',
                run: () =>
                    dispatch({
                        type: 'setSelection',
                        ids: state.rows.filter((row) => row.status === 'matched').map((row) => row.id)
                    })
            },
            {
                id: 'clear-selection',
                label: 'Togli ogni spunta',
                run: () => dispatch({ type: 'clearSelection' }),
                disabled: counts.selected === 0
            },
            {
                id: 'focus-title',
                label: 'Vai alla colonna Titolo',
                run: () =>
                    state.focusRowId &&
                    dispatch({ type: 'focusCell', rowId: state.focusRowId, column: columnIndex('clean_title') })
            },
            {
                id: 'type',
                label: 'Alterna questa riga fra film ed episodio',
                chord: TYPE_CHORD,
                run: () => dispatch({ type: 'cycleChoice', column: columnIndex('media_type') }),
                disabled: state.focusRowId === null
            },
            {
                id: 'confidence',
                label: 'Che cos’è il confidence score, e come viene calcolato',
                run: () => setMode('confidence')
            },
            { id: 'settings', label: 'Impostazioni', chord: 'mod+,', run: () => setMode('settings') },
            { id: 'cache', label: 'Svuota la cache delle API', run: () => void emptyCache() },
            { id: 'keymap', label: 'Scorciatoie da tastiera', chord: 'mod+/', run: () => setMode('keymap') },
            { id: 'about', label: 'Versione e build in esecuzione', run: () => setMode('about') }
        ],
        [counts.selected, emptyCache, openTriage, openTriageRow, queue.length, scan, state.focusRowId, state.rows]
    );

    /**
     * The keyboard belongs to the grid whenever nothing is on top of it.
     *
     * Clicking Scan leaves the DOM focus on the button, and an overlay takes it while it
     * is open; in both cases not a single grid key arrives — F2, the arrows, `space` — so
     * the whole model is unreachable until the user thinks to click a cell. Handing focus
     * back on every return to `grid`, and once the first rows exist, is what fixes that.
     *
     * The other direction is the one that bites. An overlay opened by a chord — `Ctrl+G`
     * on a row — leaves the DOM focus on the grid, so the grid's own handler keeps
     * running underneath: the arrows meant for the overlay walked the cursor behind it,
     * and the cell the next keystroke landed on was not the one it was aimed at.
     */
    useEffect(() => {
        if (mode === 'grid') gridRef.current?.focus();
        else if (gridRef.current?.contains(document.activeElement)) gridRef.current.blur();
    }, [mode, state.rows.length]);

    // Global chords: the ones that have to work wherever focus happens to be. Everything
    // unmodified belongs to the grid, which is what keeps typing into a cell unambiguous.
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (matchesChord(event, 'mod+k')) {
                event.preventDefault();
                setMode((current) => (current === 'palette' ? 'grid' : 'palette'));
            } else if (matchesChord(event, 'mod+enter')) {
                event.preventDefault();
                // Not while the confirmation is up: there the same chord is the
                // confirmation itself, and the dialog owns it.
                if (mode !== 'confirm' && counts.selected > 0) setMode('confirm');
            } else if (matchesChord(event, SCAN_CHORD)) {
                // The browser reloads on this one; preventing it works, and a reload is
                // the harmless failure mode if some browser ever refuses.
                event.preventDefault();
                void scan();
            } else if (matchesChord(event, TRIAGE_ROW_CHORD)) {
                event.preventDefault();
                openTriageRow(state.focusRowId);
            } else if (matchesChord(event, TRIAGE_CHORD)) {
                event.preventDefault();
                openTriage(null);
            } else if (matchesChord(event, 'mod+,')) {
                event.preventDefault();
                setMode('settings');
            } else if (matchesChord(event, 'mod+/')) {
                event.preventDefault();
                setMode('keymap');
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [counts.selected, mode, openTriage, openTriageRow, scan, state.focusRowId]);

    return (
        <div className="app">
            <CommandBar
                directory={settings.directory}
                onDirectoryChange={(directory) => setSettings((current) => ({ ...current, directory }))}
                busy={busy}
                counts={counts}
                onScan={() => void scan()}
                onTriage={() => openTriage(null)}
                onRename={() => setMode('confirm')}
                onSettings={() => setMode('settings')}
                onKeymap={() => setMode('keymap')}
                onAbout={() => setMode('about')}
            />

            <main className="stage">
                {state.rows.length === 0 && busy === null ? (
                    <div className="empty">
                        <p className="empty-title">Avvia la scansione</p>
                        <p className="empty-hint">
                            Seleziona una cartella dentro{' '}
                            <span className="mono">{config ? config.media_roots.join(' o ') : 'la radice multimediale'}</span>{' '}
                            e premi <kbd>Invio</kbd>.
                        </p>
                    </div>
                ) : (
                    <Grid
                        ref={gridRef}
                        state={state}
                        dispatch={dispatch}
                        onOpenTriage={openTriage}
                        onCopy={copyCell}
                        onPaste={() => void pasteCell()}
                        onExplainConfidence={() => setMode('confidence')}
                    />
                )}
            </main>

            <StatusBar counts={counts} directory={settings.directory} mode={mode} />

            {mode === 'triage' && (
                <TriageOverlay
                    rows={state.rows}
                    queue={triageQueue}
                    startId={triageStart}
                    onPick={(items, candidate, extra) => void applyPick(items, candidate, extra)}
                    onSearch={searchByHand}
                    onSkip={() => undefined}
                    onClose={() => setMode('grid')}
                />
            )}
            {mode === 'settings' && (
                <SettingsPanel
                    settings={settings}
                    config={config}
                    onApply={applySettings}
                    onClearCache={() => void emptyCache()}
                    onClose={() => setMode('grid')}
                />
            )}
            {mode === 'keymap' && <KeymapOverlay onClose={() => setMode('grid')} />}
            {mode === 'about' && <AboutOverlay onClose={() => setMode('grid')} />}
            {mode === 'confidence' && (
                // The bands it describes are the ones in force, not the shipped defaults.
                <ConfidenceOverlay
                    review={settings.reviewThreshold}
                    match={settings.matchThreshold}
                    onClose={() => setMode('grid')}
                />
            )}
            {mode === 'palette' && <CommandPalette commands={commands} onClose={() => setMode('grid')} />}
            {mode === 'confirm' && (
                <ConfirmRename items={selectedItems} onConfirm={() => void rename()} onCancel={() => setMode('grid')} />
            )}

            <Toasts toasts={toasts} onDismiss={dismiss} />
        </div>
    );
};

export default App;
