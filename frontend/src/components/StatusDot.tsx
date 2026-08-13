import React from 'react';
import { MediaItem } from '../api';

/**
 * Row status as a dot, never as a word.
 *
 * The dots differ by *fill* as well as by hue — solid, hollow, crossed, ticked —
 * so the state survives a colour-blind reader, a bad monitor and a screenshot.
 * The word itself is still there for anyone who wants it, as the accessible name.
 */

const LABELS: Record<MediaItem['status'], string> = {
    pending: 'Non ancora analizzato',
    analyzing: 'Interrogo TMDB/TVDB…',
    matched: 'Abbinamento sicuro — spuntato per la rinomina',
    review: 'Ambiguo — conferma il candidato prima di rinominare',
    renaming: 'Rinomina in corso…',
    error: 'Nessun abbinamento utilizzabile',
    success: 'Rinominato'
};

export const StatusDot: React.FC<{ item: MediaItem }> = ({ item }) => {
    const title = item.message ? `${LABELS[item.status]} — ${item.message}` : LABELS[item.status];

    return (
        <span className="status-dot" role="img" aria-label={title} title={title}>
            {/* Drawn on a 12-unit grid and painted at 14: the geometry below stays
                comparable with the strokes everywhere else, and the target the mouse has
                to hit — the thing that opens triage on the row — grows with it. */}
            <svg width="14" height="14" viewBox="0 0 12 12" aria-hidden="true">
                {item.status === 'matched' && <circle cx="6" cy="6" r="4" fill="var(--verify-teal)" />}
                {item.status === 'review' && <circle cx="6" cy="6" r="3.6" fill="none" stroke="var(--caution-ochre)" strokeWidth="1.6" />}
                {item.status === 'pending' && <circle cx="6" cy="6" r="3.6" fill="none" stroke="var(--dim-steel)" strokeWidth="1.2" strokeDasharray="2 2" />}
                {/* The pending ring, set turning, plus a centre it does not have — so the
                    two are still told apart in a screenshot, where nothing moves. Steel
                    rather than amber: this one is only asking a question, whereas
                    `renaming` is writing to the library. */}
                {item.status === 'analyzing' && (
                    <>
                        <g className="status-dot-spin">
                            <circle cx="6" cy="6" r="4.4" fill="none" stroke="var(--muted-steel)" strokeWidth="1.2" strokeDasharray="2.3 2.3" />
                        </g>
                        <circle cx="6" cy="6" r="1.5" fill="var(--muted-steel)" />
                    </>
                )}
                {item.status === 'error' && (
                    <>
                        <circle cx="6" cy="6" r="4.2" fill="var(--fault-rust)" />
                        <path d="M4.3 4.3l3.4 3.4M7.7 4.3l-3.4 3.4" stroke="var(--console-black)" strokeWidth="1.3" strokeLinecap="round" />
                    </>
                )}
                {item.status === 'success' && (
                    <>
                        <circle cx="6" cy="6" r="4.2" fill="var(--verify-teal)" />
                        <path d="M4 6.2l1.5 1.6L8.2 4.6" stroke="var(--console-black)" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    </>
                )}
                {item.status === 'renaming' && (
                    <g className="status-dot-spin">
                        <circle cx="6" cy="6" r="3.8" fill="none" stroke="var(--hairline)" strokeWidth="1.6" />
                        <path d="M6 2.2a3.8 3.8 0 0 1 3.8 3.8" fill="none" stroke="var(--signal-amber)" strokeWidth="1.6" strokeLinecap="round" />
                    </g>
                )}
            </svg>
        </span>
    );
};
