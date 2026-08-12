import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
    analyzeItem,
    AppConfig,
    CandidateOut,
    clearCache,
    getConfig,
    MediaItem,
    renameItems,
    scanDirectory
} from './api';
import { CommandBar, Counts } from './components/CommandBar';
import { Command, CommandPalette } from './components/CommandPalette';
import { ConfirmRename } from './components/ConfirmRename';
import { Grid } from './components/Grid';
import { KeymapOverlay } from './components/KeymapOverlay';
import { SettingsPanel } from './components/SettingsPanel';
import { Toast, Toasts } from './components/Toasts';
import { TriageOverlay } from './components/TriageOverlay';
import { columnIndex } from './lib/columns';
import { gridReducer, initialGridState } from './lib/gridReducer';
import { matchesChord } from './lib/keymap';
import { runPool } from './lib/pool';
import { needsTriage } from './lib/series';
import { hasStoredSettings, readStoredSettings, saveSettings, Settings, settingsFromConfig } from './lib/settings';
import './styles/app.css';

/**
 * The shell.
 *
 * It owns the network and the modes; the grid owns the keyboard and the reducer owns
 * the data. Nothing here decides what a key does — that lives in `gridReducer`, which
 * is testable without a DOM.
 */

const ANALYZE_CONCURRENCY = 6;

type Mode = 'grid' | 'triage' | 'settings' | 'keymap' | 'palette' | 'confirm';

const App: React.FC = () => {
    const [state, dispatch] = useReducer(gridReducer, undefined, () => initialGridState([]));
    const [settings, setSettings] = useState<Settings>(() => readStoredSettings());
    const [config, setConfig] = useState<AppConfig | null>(null);
    const [mode, setMode] = useState<Mode>('grid');
    const [triageStart, setTriageStart] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [toasts, setToasts] = useState<Toast[]>([]);
    const toastSeq = useRef(0);

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
                    say('TMDB or TVDB key missing — analysis will match nothing until it is configured', 'error');
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
            bypassCache: settings.bypassCache,
            languages: settings.languages,
            matchThreshold: settings.matchThreshold,
            reviewThreshold: settings.reviewThreshold
        }),
        [settings.bypassCache, settings.languages, settings.matchThreshold, settings.reviewThreshold]
    );

    /** One request per file, capped, with each row filling in as its answer lands. */
    const analyzeAll = useCallback(
        async (items: MediaItem[], forcedKey: string | undefined, label: string): Promise<MediaItem[]> => {
            let done = 0;
            setBusy(`${label} 0/${items.length}`);
            const results = await runPool(
                items,
                ANALYZE_CONCURRENCY,
                async (item) => {
                    try {
                        return await analyzeItem(item, { ...analyzeOptions, forcedKey });
                    } catch (error) {
                        return { ...item, status: 'error' as const, message: (error as Error).message };
                    }
                },
                (result) => {
                    done += 1;
                    setBusy(`${label} ${done}/${items.length}`);
                    dispatch({ type: 'mergeRows', rows: [result] });
                }
            );
            setBusy(null);
            return results;
        },
        [analyzeOptions]
    );

    const analyze = useCallback(
        async (items: MediaItem[]) => {
            if (items.length === 0) return;
            const analyzed = await analyzeAll(items, undefined, 'Analyzing');

            if (settings.autoSelectMatched) {
                const confident = analyzed.filter((item) => item.status === 'matched').map((item) => item.id);
                if (confident.length > 0) dispatch({ type: 'setSelection', ids: confident });
            }
            const unsettled = analyzed.filter((item) => item.status === 'review' || item.status === 'error').length;
            if (unsettled > 0) say(`${unsettled} file(s) need a decision — Ctrl+T to triage them`);
        },
        [analyzeAll, say, settings.autoSelectMatched]
    );

    const scan = useCallback(async () => {
        setBusy('Scanning');
        let found: MediaItem[];
        try {
            found = await scanDirectory(settings.directory, settings.bypassCache, settings.languages);
        } catch (error) {
            setBusy(null);
            say((error as Error).message, 'error');
            return;
        }
        dispatch({ type: 'setRows', rows: found });
        setBusy(null);
        if (found.length === 0) say('No media files in that directory');
        else if (settings.analyzeOnScan) await analyze(found);
    }, [analyze, say, settings.analyzeOnScan, settings.bypassCache, settings.directory, settings.languages]);

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
        async (items: MediaItem[], candidate: CandidateOut) => {
            await analyzeAll(items, candidate.key, `Applying ${candidate.label} —`);
            say(`${candidate.label} applied to ${items.length} file(s)`);
        },
        [analyzeAll, say]
    );

    const selectedItems = useMemo(
        () => state.rows.filter((row) => state.selected.has(row.id)),
        [state.rows, state.selected]
    );

    const rename = useCallback(async () => {
        if (selectedItems.length === 0) return;
        setMode('grid');
        setBusy(`Renaming ${selectedItems.length} file(s)`);
        dispatch({ type: 'mergeRows', rows: selectedItems.map((item) => ({ ...item, status: 'renaming' as const })) });
        try {
            const results = await renameItems(selectedItems);
            dispatch({ type: 'mergeRows', rows: results });
            const failed = results.filter((item) => item.status === 'error');
            const renamed = results.length - failed.length;
            if (renamed > 0) say(`Renamed ${renamed} file(s)`);
            if (failed.length > 0) say(`${failed.length} file(s) could not be renamed — see the row message`, 'error');
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
            say(`Cache emptied — ${cleared} entr${cleared === 1 ? 'y' : 'ies'} dropped`);
            const refreshed = await getConfig().catch(() => null);
            if (refreshed) setConfig(refreshed);
        } catch (error) {
            say((error as Error).message, 'error');
        }
    }, [say]);

    const copyCell = useCallback(
        (text: string) => {
            navigator.clipboard?.writeText(text).catch(() => say('The browser refused the clipboard', 'error'));
        },
        [say]
    );

    const pasteCell = useCallback(async () => {
        try {
            const text = await navigator.clipboard.readText();
            if (state.focusRowId) dispatch({ type: 'setCell', rowId: state.focusRowId, column: state.focusColumn, text });
        } catch {
            say('The browser refused the clipboard — paste inside the cell editor instead', 'error');
        }
    }, [say, state.focusColumn, state.focusRowId]);

    const queue = useMemo(() => needsTriage(state.rows), [state.rows]);

    const openTriage = useCallback(
        (rowId: string | null) => {
            if (queue.length === 0) {
                say('Nothing to triage');
                return;
            }
            setTriageStart(rowId);
            setMode('triage');
        },
        [queue.length, say]
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
            { id: 'scan', label: 'Scan the directory', chord: 'mod+r', run: () => void scan() },
            {
                id: 'analyze',
                label: 'Analyze every file',
                run: () => void analyze(state.rows),
                disabled: state.rows.length === 0
            },
            {
                id: 'analyze-pending',
                label: 'Analyze only the files with no proposal yet',
                run: () => void analyze(state.rows.filter((row) => row.status === 'pending')),
                disabled: !state.rows.some((row) => row.status === 'pending')
            },
            {
                id: 'triage',
                label: 'Triage the unsettled files',
                chord: 'mod+t',
                run: () => openTriage(null),
                disabled: queue.length === 0
            },
            {
                id: 'rename',
                label: `Rename the ${counts.selected} ticked file(s)`,
                chord: 'mod+enter',
                run: () => setMode('confirm'),
                disabled: counts.selected === 0
            },
            {
                id: 'select-matched',
                label: 'Tick every confident match',
                run: () =>
                    dispatch({
                        type: 'setSelection',
                        ids: state.rows.filter((row) => row.status === 'matched').map((row) => row.id)
                    })
            },
            {
                id: 'clear-selection',
                label: 'Untick everything',
                run: () => dispatch({ type: 'clearSelection' }),
                disabled: counts.selected === 0
            },
            {
                id: 'focus-title',
                label: 'Jump to the Title column',
                run: () =>
                    state.focusRowId &&
                    dispatch({ type: 'focusCell', rowId: state.focusRowId, column: columnIndex('clean_title') })
            },
            { id: 'settings', label: 'Settings', chord: 'mod+,', run: () => setMode('settings') },
            { id: 'cache', label: 'Empty the API cache', run: () => void emptyCache() },
            { id: 'keymap', label: 'Keyboard shortcuts', chord: 'mod+/', run: () => setMode('keymap') }
        ],
        [analyze, counts.selected, emptyCache, openTriage, queue.length, scan, state.focusRowId, state.rows]
    );

    // Global chords: the ones that have to work wherever focus happens to be. Everything
    // unmodified belongs to the grid, which is what keeps typing into a cell unambiguous.
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (matchesChord(event, 'mod+k')) {
                event.preventDefault();
                setMode((current) => (current === 'palette' ? 'grid' : 'palette'));
            } else if (matchesChord(event, 'mod+enter')) {
                event.preventDefault();
                if (counts.selected > 0) setMode('confirm');
            } else if (matchesChord(event, 'mod+r')) {
                event.preventDefault();
                void scan();
            } else if (matchesChord(event, 'mod+t')) {
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
    }, [counts.selected, openTriage, scan]);

    return (
        <div className="app">
            <CommandBar
                directory={settings.directory}
                onDirectoryChange={(directory) => setSettings((current) => ({ ...current, directory }))}
                busy={busy}
                counts={counts}
                onScan={() => void scan()}
                onAnalyze={() => void analyze(state.rows)}
                onTriage={() => openTriage(null)}
                onRename={() => setMode('confirm')}
                onSettings={() => setMode('settings')}
                onKeymap={() => setMode('keymap')}
            />

            <main className="stage">
                {state.rows.length === 0 && busy === null ? (
                    <div className="empty">
                        <p className="empty-title">Nothing scanned yet</p>
                        <p className="empty-hint">
                            Point the bar at a directory inside{' '}
                            <span className="mono">{config ? config.media_roots.join(' or ') : 'the media root'}</span> and
                            press <kbd>Enter</kbd>.
                        </p>
                    </div>
                ) : (
                    <Grid
                        state={state}
                        dispatch={dispatch}
                        onOpenTriage={openTriage}
                        onCopy={copyCell}
                        onPaste={() => void pasteCell()}
                    />
                )}
            </main>

            {mode === 'triage' && (
                <TriageOverlay
                    rows={state.rows}
                    queue={queue}
                    startId={triageStart}
                    onPick={(items, candidate) => void applyPick(items, candidate)}
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
            {mode === 'palette' && <CommandPalette commands={commands} onClose={() => setMode('grid')} />}
            {mode === 'confirm' && (
                <ConfirmRename items={selectedItems} onConfirm={() => void rename()} onCancel={() => setMode('grid')} />
            )}

            <Toasts toasts={toasts} onDismiss={dismiss} />
        </div>
    );
};

export default App;
