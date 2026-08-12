import React from 'react';
import { KeyStatus } from '../api';

/**
 * A key's health as one icon, checked live.
 *
 * Icon only, because the alternative is printing something about a secret next to it and
 * the useful part is a single bit anyway. The four shapes differ by fill as well as hue,
 * the same rule `StatusDot` follows, and the sentence from the backend is the accessible
 * name and the tooltip — it never contains the key, only the status code that came back.
 */

const TONE: Record<KeyStatus['state'], string> = {
    ok: 'is-ok',
    invalid: 'is-bad',
    missing: 'is-missing',
    unreachable: 'is-unknown'
};

export const KeyStatusIcon: React.FC<{ status: KeyStatus | null; checking: boolean }> = ({ status, checking }) => {
    if (checking || !status) {
        const label = checking ? 'Checking…' : 'Not checked yet';
        return (
            <span className="key-icon is-unknown" role="img" aria-label={label} title={label}>
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                    <circle cx="7" cy="7" r="4.4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2 2">
                        {checking && <animateTransform attributeName="transform" type="rotate" from="0 7 7" to="360 7 7" dur="2.4s" repeatCount="indefinite" />}
                    </circle>
                </svg>
            </span>
        );
    }

    return (
        <span className={`key-icon ${TONE[status.state] ?? 'is-unknown'}`} role="img" aria-label={status.detail} title={status.detail}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                {status.state === 'ok' && (
                    <>
                        <circle cx="7" cy="7" r="5" fill="currentColor" />
                        <path d="M4.6 7.2 6.4 9l3-3.4" fill="none" stroke="var(--console-black)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </>
                )}
                {status.state === 'invalid' && (
                    <>
                        <circle cx="7" cy="7" r="5" fill="currentColor" />
                        <path d="M5.1 5.1l3.8 3.8M8.9 5.1l-3.8 3.8" stroke="var(--console-black)" strokeWidth="1.5" strokeLinecap="round" />
                    </>
                )}
                {status.state === 'missing' && (
                    <circle cx="7" cy="7" r="4.4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2 2" />
                )}
                {status.state === 'unreachable' && (
                    <>
                        <circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
                        <path d="M3.9 3.9l6.2 6.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                    </>
                )}
            </svg>
        </span>
    );
};
