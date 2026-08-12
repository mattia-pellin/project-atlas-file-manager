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
    pending: 'Not analyzed yet',
    matched: 'Confident match — ticked for rename',
    review: 'Ambiguous — confirm the candidate before renaming',
    renaming: 'Renaming…',
    error: 'No usable match',
    success: 'Renamed'
};

export const StatusDot: React.FC<{ item: MediaItem }> = ({ item }) => {
    const title = item.message ? `${LABELS[item.status]} — ${item.message}` : LABELS[item.status];

    return (
        <span className="status-dot" role="img" aria-label={title} title={title}>
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                {item.status === 'matched' && <circle cx="6" cy="6" r="4" fill="var(--verify-teal)" />}
                {item.status === 'review' && <circle cx="6" cy="6" r="3.6" fill="none" stroke="var(--caution-ochre)" strokeWidth="1.6" />}
                {item.status === 'pending' && <circle cx="6" cy="6" r="3.6" fill="none" stroke="var(--dim-steel)" strokeWidth="1.2" strokeDasharray="2 2" />}
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
