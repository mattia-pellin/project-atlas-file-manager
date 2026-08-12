import React, { useCallback, useEffect, useState } from 'react';
import { AppConfig, checkKeys, KeyCheck } from '../api';
import { languagesError, parseLanguages, serializeLanguages } from '../lib/languages';
import { DEFAULT_SETTINGS, Settings } from '../lib/settings';
import { Kbd } from './Kbd';
import { KeyStatusIcon } from './KeyStatusIcon';
import { LanguageEditor } from './LanguageEditor';
import { ThresholdSlider } from './ThresholdSlider';

/**
 * Every override, in one window.
 *
 * Four sections, and each one is a thing the user can get wrong in a way the app cannot
 * detect later: a directory outside the root, a language code nothing speaks, a pair of
 * thresholds that decide what gets renamed unattended, and a key that is set but dead.
 * So each one is checked here, in front of the user, rather than turning into a row that
 * says "Could not find a match".
 *
 * What is *not* here is as deliberate. There is no "tick confident matches" switch —
 * that is what a confidence threshold is for, and having both meant two controls
 * fighting over one behaviour. There is no "ignore the cache" switch either: emptying
 * the cache is the same thing, done once, and does not silently multiply every future
 * scan's API traffic.
 */

interface SettingsProps {
    settings: Settings;
    config: AppConfig | null;
    onApply: (settings: Settings) => void;
    onClearCache: () => void;
    onClose: () => void;
}

const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const SettingsPanel: React.FC<SettingsProps> = ({ settings, config, onApply, onClearCache, onClose }) => {
    const [draft, setDraft] = useState<Settings>(settings);
    const [codes, setCodes] = useState<string[]>(() => parseLanguages(settings.languages));
    const [keys, setKeys] = useState<KeyCheck | null>(null);
    const [checking, setChecking] = useState(false);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [onClose]);

    /** Uses each key once. Nothing is cached, so an "ok" here is about right now. */
    const recheck = useCallback(async () => {
        setChecking(true);
        try {
            setKeys(await checkKeys());
        } catch (error) {
            const detail = (error as Error).message;
            setKeys({ tmdb: { state: 'unreachable', detail }, tvdb: { state: 'unreachable', detail } });
        }
        setChecking(false);
    }, []);

    useEffect(() => {
        void recheck();
    }, [recheck]);

    const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
        setDraft((current) => ({ ...current, [key]: value }));

    const languageError = languagesError(codes);

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
                        <Kbd chord="escape" />
                    </button>
                </header>

                <div className="panel-body">
                    <section className="field-group">
                        <h3>Scan</h3>
                        <div className="field">
                            <input
                                className="input mono"
                                value={draft.directory}
                                spellCheck={false}
                                aria-label="Directory to scan"
                                onChange={(event) => set('directory', event.target.value)}
                            />
                            <span className="field-hint">
                                Must resolve inside {config ? config.media_roots.join(', ') : 'the configured roots'}.
                            </span>
                        </div>
                    </section>

                    <section className="field-group">
                        <h3>Languages</h3>
                        <LanguageEditor codes={codes} onChange={setCodes} />
                        {languageError ? (
                            <p className="field-error">{languageError}</p>
                        ) : (
                            <span className="field-hint">
                                Most preferred first — click a code to move it to the front, × to drop it.
                            </span>
                        )}
                    </section>

                    <section className="field-group">
                        <h3>Confidence</h3>
                        <ThresholdSlider
                            review={draft.reviewThreshold}
                            match={draft.matchThreshold}
                            onChange={({ review, match }) =>
                                setDraft((current) => ({ ...current, reviewThreshold: review, matchThreshold: match }))
                            }
                        />
                        <span className="field-hint">
                            Default {DEFAULT_SETTINGS.reviewThreshold.toFixed(2)} and{' '}
                            {DEFAULT_SETTINGS.matchThreshold.toFixed(2)}. Confidence is the leader's score damped by how
                            close the runner-up is, so a tie lands in the middle band whatever the titles score alone.
                        </span>
                    </section>

                    <div className="settings-split">
                        <section className="field-group">
                            <h3>
                                API keys
                                <button
                                    type="button"
                                    className="button ghost tiny"
                                    onClick={() => void recheck()}
                                    disabled={checking}
                                >
                                    Re-check
                                </button>
                            </h3>
                            <ul className="key-list">
                                <li>
                                    <span>TMDB</span>
                                    <KeyStatusIcon status={keys?.tmdb ?? null} checking={checking} />
                                </li>
                                <li>
                                    <span>TVDB</span>
                                    <KeyStatusIcon status={keys?.tvdb ?? null} checking={checking} />
                                </li>
                            </ul>
                        </section>

                        <section className="field-group">
                            <h3>Cache</h3>
                            <p className="cache-line mono">
                                {config
                                    ? `${config.cache_entries} entries · ${formatBytes(config.cache_size_bytes)} · ${config.cache_ttl_hours} h`
                                    : '—'}
                            </p>
                            <button type="button" className="button" onClick={onClearCache}>
                                Empty the cache
                            </button>
                        </section>
                    </div>
                </div>

                <footer className="panel-foot">
                    <button
                        type="button"
                        className="button ghost"
                        onClick={() => {
                            setDraft({ ...DEFAULT_SETTINGS, directory: draft.directory });
                            setCodes(parseLanguages(DEFAULT_SETTINGS.languages));
                        }}
                    >
                        Reset to defaults
                    </button>
                    <div className="spacer" />
                    <button type="button" className="button ghost" onClick={onClose}>
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="button primary"
                        disabled={languageError !== null}
                        onClick={() => onApply({ ...draft, languages: serializeLanguages(codes) })}
                    >
                        Apply
                    </button>
                </footer>
            </div>
        </div>
    );
};
