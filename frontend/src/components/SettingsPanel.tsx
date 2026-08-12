import React, { useEffect, useState } from 'react';
import { AppConfig } from '../api';
import { DEFAULT_SETTINGS, Settings } from '../lib/settings';

/**
 * Every override, in one panel.
 *
 * Two kinds of value live here and they are deliberately shown apart: what the user
 * controls (top) and what the server reports (bottom, read-only). The thresholds are
 * the sharp ones — they decide whether a row is renamed unattended — so they show the
 * default they moved away from, and the impossible pair is refused here rather than
 * turning into a 400 on every single row.
 */

interface SettingsProps {
    settings: Settings;
    config: AppConfig | null;
    onApply: (settings: Settings) => void;
    onClearCache: () => void;
    onClose: () => void;
}

const clampFraction = (value: number): number => Math.min(1, Math.max(0, value));

const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const SettingsPanel: React.FC<SettingsProps> = ({ settings, config, onApply, onClearCache, onClose }) => {
    const [draft, setDraft] = useState<Settings>(settings);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [onClose]);

    const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setDraft((current) => ({ ...current, [key]: value }));

    // The backend rejects review > match outright rather than reordering the pair; the
    // slider does the same, so the state the user can see is always a state that works.
    const impossible = draft.reviewThreshold > draft.matchThreshold;

    return (
        <div className="scrim" onMouseDown={onClose}>
            <div
                className="panel settings"
                role="dialog"
                aria-modal="true"
                aria-label="Settings"
                onMouseDown={(event) => event.stopPropagation()}
            >
                <header className="panel-head">
                    <h2>Settings</h2>
                    <button type="button" className="button ghost" onClick={onClose}>
                        Esc
                    </button>
                </header>

                <div className="panel-body">
                    <section className="field-group">
                        <h3>Library</h3>
                        <label className="field">
                            <span className="field-label">Directory to scan</span>
                            <input
                                className="input mono"
                                value={draft.directory}
                                spellCheck={false}
                                onChange={(event) => set('directory', event.target.value)}
                            />
                            <span className="field-hint">
                                Must resolve inside {config ? config.media_roots.join(', ') : 'the configured roots'}.
                            </span>
                        </label>
                        <label className="field">
                            <span className="field-label">Language preference</span>
                            <input
                                className="input mono"
                                value={draft.languages}
                                spellCheck={false}
                                onChange={(event) => set('languages', event.target.value)}
                            />
                            <span className="field-hint">Comma-separated, most preferred first — titles are taken in this order.</span>
                        </label>
                    </section>

                    <section className="field-group">
                        <h3>Confidence</h3>
                        <label className="field">
                            <span className="field-label">
                                Auto-select at or above
                                <strong className="mono">{draft.matchThreshold.toFixed(2)}</strong>
                            </span>
                            <input
                                type="range"
                                min={0}
                                max={1}
                                step={0.01}
                                value={draft.matchThreshold}
                                onChange={(event) => set('matchThreshold', clampFraction(Number(event.target.value)))}
                            />
                            <span className="field-hint">
                                A row this confident is ticked for rename without being looked at. Default {DEFAULT_SETTINGS.matchThreshold.toFixed(2)}.
                            </span>
                        </label>
                        <label className="field">
                            <span className="field-label">
                                Propose a name at or above
                                <strong className="mono">{draft.reviewThreshold.toFixed(2)}</strong>
                            </span>
                            <input
                                type="range"
                                min={0}
                                max={1}
                                step={0.01}
                                value={draft.reviewThreshold}
                                onChange={(event) => set('reviewThreshold', clampFraction(Number(event.target.value)))}
                            />
                            <span className="field-hint">
                                Below this the row is left unnamed and goes to triage. Default {DEFAULT_SETTINGS.reviewThreshold.toFixed(2)}.
                            </span>
                        </label>
                        {impossible && <p className="field-error">The review threshold cannot sit above the match threshold.</p>}
                    </section>

                    <section className="field-group">
                        <h3>Behaviour</h3>
                        <label className="check">
                            <input
                                type="checkbox"
                                checked={draft.analyzeOnScan}
                                onChange={(event) => set('analyzeOnScan', event.target.checked)}
                            />
                            <span>Analyze every file straight after a scan</span>
                        </label>
                        <label className="check">
                            <input
                                type="checkbox"
                                checked={draft.autoSelectMatched}
                                onChange={(event) => set('autoSelectMatched', event.target.checked)}
                            />
                            <span>Tick confident matches automatically</span>
                        </label>
                        <label className="check">
                            <input
                                type="checkbox"
                                checked={draft.bypassCache}
                                onChange={(event) => set('bypassCache', event.target.checked)}
                            />
                            <span>Ignore the cache and ask TMDB/TVDB again</span>
                        </label>
                    </section>

                    <section className="field-group">
                        <h3>Cache and keys</h3>
                        <dl className="readout">
                            <div>
                                <dt>Cached entries</dt>
                                <dd className="mono">{config ? config.cache_entries : '—'}</dd>
                            </div>
                            <div>
                                <dt>On disk</dt>
                                <dd className="mono">{config ? formatBytes(config.cache_size_bytes) : '—'}</dd>
                            </div>
                            <div>
                                <dt>Entries expire after</dt>
                                <dd className="mono">{config ? `${config.cache_ttl_hours} h` : '—'}</dd>
                            </div>
                            <div>
                                <dt>TMDB key</dt>
                                <dd>{config?.tmdb_configured ? 'configured' : 'missing'}</dd>
                            </div>
                            <div>
                                <dt>TVDB key</dt>
                                <dd>{config?.tvdb_configured ? 'configured' : 'missing'}</dd>
                            </div>
                        </dl>
                        <button type="button" className="button" onClick={onClearCache}>
                            Empty the cache
                        </button>
                    </section>
                </div>

                <footer className="panel-foot">
                    <button type="button" className="button ghost" onClick={() => setDraft({ ...DEFAULT_SETTINGS, directory: draft.directory })}>
                        Reset to defaults
                    </button>
                    <div className="spacer" />
                    <button type="button" className="button ghost" onClick={onClose}>
                        Cancel
                    </button>
                    <button type="button" className="button primary" disabled={impossible} onClick={() => onApply(draft)}>
                        Apply
                    </button>
                </footer>
            </div>
        </div>
    );
};
