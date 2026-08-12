import React, { useState } from 'react';
import { isLanguageCode, languageName, parseLanguages, promoteLanguage, removeLanguage } from '../lib/languages';

/**
 * The language chain, as tokens rather than as a comma-separated string.
 *
 * A bad code is shown as bad the moment it is entered — red chip, warning glyph, and the
 * reason spelled out underneath — because nothing downstream will ever complain about
 * it: the providers answer an unknown language with untranslated titles, not an error.
 *
 * Clicking a chip promotes it to the front. That is the only reordering offered on
 * purpose: the list is a fallback chain, so the only question anyone actually has is
 * which language wins, and answering it with a drag is worse than answering it with a
 * click that a keyboard can also make.
 */

interface LanguageEditorProps {
    codes: string[];
    onChange: (codes: string[]) => void;
}

const WarnGlyph = () => (
    <svg className="lang-glyph" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
        <path d="M5 1.2 9.2 8.6H0.8z" fill="none" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
        <path d="M5 4v2.1" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
        <circle cx="5" cy="7.4" r="0.55" fill="currentColor" />
    </svg>
);

export const LanguageEditor: React.FC<LanguageEditorProps> = ({ codes, onChange }) => {
    const [draft, setDraft] = useState('');

    /** Commits whatever is half-typed. Invalid codes are kept, not swallowed — an
        entry that vanished on Enter would read as accepted. */
    const commit = (text: string) => {
        const added = parseLanguages(text).filter((code) => !codes.includes(code));
        if (added.length > 0) onChange([...codes, ...added]);
        setDraft('');
    };

    const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter' || event.key === ',' || event.key === ' ' || event.key === 'Tab') {
            if (draft.trim() === '') return;
            // Tab still moves on; the others exist only to end a token.
            if (event.key !== 'Tab') event.preventDefault();
            commit(draft);
        } else if (event.key === 'Backspace' && draft === '' && codes.length > 0) {
            event.preventDefault();
            onChange(codes.slice(0, -1));
        }
    };

    return (
        <div className="lang-chips" onClick={(event) => event.currentTarget.querySelector('input')?.focus()}>
            {codes.map((code, index) => {
                const valid = isLanguageCode(code);
                const name = valid ? languageName(code) : null;
                const position = index === 0 ? 'preferred' : `fallback ${index}`;
                return (
                    <span key={code} className={`lang-chip${valid ? '' : ' is-bad'}${index === 0 ? ' is-first' : ''}`}>
                        <button
                            type="button"
                            className="lang-chip-body"
                            title={valid ? `${name ?? code} — ${position}. Click to prefer it.` : `${code} is not a language code`}
                            onClick={() => onChange(promoteLanguage(codes, code))}
                        >
                            {!valid && <WarnGlyph />}
                            <span className="mono">{code}</span>
                        </button>
                        <button
                            type="button"
                            className="lang-chip-x"
                            aria-label={`Remove ${code}`}
                            title={`Remove ${code}`}
                            onClick={() => onChange(removeLanguage(codes, code))}
                        >
                            ×
                        </button>
                    </span>
                );
            })}
            <input
                className="lang-input mono"
                value={draft}
                spellCheck={false}
                aria-label="Add a language code"
                placeholder={codes.length === 0 ? 'it' : ''}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onKeyDown}
                onBlur={() => draft.trim() !== '' && commit(draft)}
            />
        </div>
    );
};
