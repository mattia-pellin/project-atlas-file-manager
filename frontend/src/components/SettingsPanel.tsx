import React, { useCallback, useEffect, useState } from 'react';
import { AppConfig, checkKeys, KeyCheck } from '../api';
import { percent } from '../lib/format';
import { languagesError, parseLanguages, serializeLanguages } from '../lib/languages';
import { DEFAULT_SETTINGS, isPoolSize, POOL_LIMITS, Settings } from '../lib/settings';
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
 * says "Nessuna corrispondenza trovata".
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

/* Three glyphs for three quantities that are otherwise three identical numbers in a
   row. Same 14px box and 1.3 stroke as `KeyStatusIcon`, so the two halves of the split
   read as one instrument panel. */

const StackGlyph: React.FC = () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
        <path d="M7 1.8 12.4 4.4 7 7 1.6 4.4 7 1.8Z" strokeLinejoin="round" />
        <path d="M1.6 7 7 9.6 12.4 7M1.6 9.6 7 12.2l5.4-2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

const DiskGlyph: React.FC = () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
        <ellipse cx="7" cy="3.6" rx="5.2" ry="1.9" />
        <path d="M1.8 3.6v6.8c0 1.05 2.33 1.9 5.2 1.9s5.2-.85 5.2-1.9V3.6" strokeLinecap="round" />
        <path d="M1.8 7c0 1.05 2.33 1.9 5.2 1.9s5.2-.85 5.2-1.9" strokeLinecap="round" />
    </svg>
);

const ClockGlyph: React.FC = () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
        <circle cx="7" cy="7" r="5.2" />
        <path d="M7 4v3.3l2.2 1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

const TrashGlyph: React.FC = () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
        <path d="M2.4 3.6h9.2M5.4 3.6V2.4h3.2v1.2" strokeLinecap="round" />
        <path d="M3.5 3.6l.6 7.4c.03.4.36.7.76.7h4.28c.4 0 .73-.3.76-.7l.6-7.4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5.9 5.9v3.6M8.1 5.9v3.6" strokeLinecap="round" />
    </svg>
);

/** One cache number: glyph, the value, and what it counts. */
const CacheStat: React.FC<{ glyph: React.ReactNode; value: string; children: React.ReactNode }> = ({
    glyph,
    value,
    children
}) => (
    <div className="cache-stat">
        {glyph}
        <strong className="mono">{value}</strong>
        <span>{children}</span>
    </div>
);

export const SettingsPanel: React.FC<SettingsProps> = ({ settings, config, onApply, onClearCache, onClose }) => {
    const [draft, setDraft] = useState<Settings>(settings);
    const [codes, setCodes] = useState<string[]>(() => parseLanguages(settings.languages));
    const [keys, setKeys] = useState<KeyCheck | null>(null);
    const [checking, setChecking] = useState(false);
    // Held as text, not as a number: a number input is empty for one keystroke while the
    // user replaces `10` with `6`, and coercing that empty string to 0 would either snap
    // the field back or apply a pool of zero.
    const [poolText, setPoolText] = useState(String(settings.analyzeConcurrency));

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
    const pool = Number(poolText.trim());
    const poolError =
        poolText.trim() !== '' && isPoolSize(pool)
            ? null
            : `Serve un numero intero fra ${POOL_LIMITS.min} e ${POOL_LIMITS.max}`;
    // `default_directory` is optional on the wire; the first root is what the backend
    // falls back to, so the hint says the same thing the backend would do.
    const homeDirectory = config?.default_directory ?? config?.media_roots[0] ?? DEFAULT_SETTINGS.directory;

    return (
        <div className="scrim" onMouseDown={onClose}>
            <div
                className="panel settings"
                role="dialog"
                aria-modal="true"
                aria-label="Impostazioni"
                onMouseDown={(event) => event.stopPropagation()}
            >
                <header className="panel-head">
                    <h2>Impostazioni</h2>
                    <button type="button" className="button ghost" onClick={onClose}>
                        <Kbd chord="escape" />
                    </button>
                </header>

                <div className="panel-body">
                    <section className="field-group">
                        <h3>Scansione</h3>
                        <div className="field">
                            <input
                                className="input mono"
                                value={draft.directory}
                                spellCheck={false}
                                aria-label="Cartella da scansionare"
                                onChange={(event) => set('directory', event.target.value)}
                            />
                            <span className="field-hint">
                                Da dove parte una scansione. <span className="mono">{homeDirectory}</span> è la cartella
                                principale della libreria, ed è quello che questa casella contiene finché non la cambi. È
                                ammessa una sottocartella di{' '}
                                {config ? config.media_roots.join(' o ') : 'le radici configurate'}; tutto ciò che sta
                                fuori viene rifiutato.
                            </span>
                        </div>
                        <div className="field">
                            <label className="field-label" htmlFor="pool-size">
                                Analisi in parallelo
                            </label>
                            <input
                                id="pool-size"
                                className="input mono narrow"
                                type="number"
                                inputMode="numeric"
                                min={POOL_LIMITS.min}
                                max={POOL_LIMITS.max}
                                step={1}
                                value={poolText}
                                onChange={(event) => setPoolText(event.target.value)}
                            />
                            {poolError ? (
                                <p className="field-error">{poolError}</p>
                            ) : (
                                <span className="field-hint">
                                    Quanti file vengono interrogati insieme. Nulla a valle mette un tetto a questo
                                    numero: è l&apos;unica cosa che decide quante richieste arrivano a TMDB e TVDB nello
                                    stesso istante. Alzarlo riempie prima una stagione intera, ma oltre una certa soglia
                                    i provider iniziano a rifiutare, e una riga rifiutata non si distingue da una che
                                    non ha trovato nulla. Il predefinito è{' '}
                                    <span className="mono">{DEFAULT_SETTINGS.analyzeConcurrency}</span>.
                                </span>
                            )}
                        </div>
                    </section>

                    <section className="field-group">
                        <h3>Lingue</h3>
                        <LanguageEditor codes={codes} onChange={setCodes} />
                        {languageError ? (
                            <p className="field-error">{languageError}</p>
                        ) : (
                            <span className="field-hint">
                                La preferita per prima — clicca un codice per portarlo in testa, × per toglierlo.
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
                            Un candidato perde sicurezza quando il successivo sembra quasi altrettanto valido: due
                            serie che corrispondono entrambe al nome del file finiscono nella fascia centrale anche se
                            presa da sola ciascuna corrisponde alla perfezione. I valori predefiniti sono{' '}
                            {percent(DEFAULT_SETTINGS.reviewThreshold)} e {percent(DEFAULT_SETTINGS.matchThreshold)}.
                        </span>
                    </section>

                    <div className="settings-split">
                        <section className="field-group">
                            <h3>
                                Chiavi API
                                <button
                                    type="button"
                                    className="button ghost tiny"
                                    onClick={() => void recheck()}
                                    disabled={checking}
                                >
                                    Ricontrolla
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
                            {/* Two rows of two, so each tile lines up with a key row beside it and the
                                pair of sections is one block rather than two of different heights. */}
                            <div className="cache-grid">
                                <CacheStat glyph={<StackGlyph />} value={config ? String(config.cache_entries) : '—'}>
                                    voci
                                </CacheStat>
                                <CacheStat
                                    glyph={<DiskGlyph />}
                                    value={config ? formatBytes(config.cache_size_bytes) : '—'}
                                >
                                    su disco
                                </CacheStat>
                                <CacheStat
                                    glyph={<ClockGlyph />}
                                    value={config ? `${config.cache_ttl_hours} h` : '—'}
                                >
                                    di validità
                                </CacheStat>
                                <button type="button" className="button danger" onClick={onClearCache}>
                                    <TrashGlyph />
                                    Svuota la cache
                                </button>
                            </div>
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
                            setPoolText(String(DEFAULT_SETTINGS.analyzeConcurrency));
                        }}
                    >
                        Ripristina i valori predefiniti
                    </button>
                    <div className="spacer" />
                    <button type="button" className="button ghost" onClick={onClose}>
                        Annulla
                    </button>
                    <button
                        type="button"
                        className="button primary"
                        disabled={languageError !== null || poolError !== null}
                        onClick={() =>
                            onApply({ ...draft, languages: serializeLanguages(codes), analyzeConcurrency: pool })
                        }
                    >
                        Applica
                    </button>
                </footer>
            </div>
        </div>
    );
};
