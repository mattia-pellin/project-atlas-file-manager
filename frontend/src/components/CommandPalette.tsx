import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Kbd } from './Kbd';

/**
 * Ctrl+K.
 *
 * Every command the toolbar can run, reachable without knowing its chord — which is
 * what keeps the toolbar itself small enough to stay out of the way.
 */

export interface Command {
    id: string;
    label: string;
    hint?: string;
    chord?: string;
    disabled?: boolean;
    run: () => void;
}

interface PaletteProps {
    commands: Command[];
    onClose: () => void;
}

export const CommandPalette: React.FC<PaletteProps> = ({ commands, onClose }) => {
    const [query, setQuery] = useState('');
    const [cursor, setCursor] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => inputRef.current?.focus(), []);

    const matches = useMemo(() => {
        const needle = query.trim().toLowerCase();
        const usable = commands.filter((command) => !command.disabled);
        if (!needle) return usable;
        return usable.filter((command) => command.label.toLowerCase().includes(needle));
    }, [commands, query]);

    const active = Math.min(cursor, Math.max(matches.length - 1, 0));

    const onKeyDown = (event: React.KeyboardEvent) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
        } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            setCursor(Math.min(active + 1, matches.length - 1));
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setCursor(Math.max(active - 1, 0));
        } else if (event.key === 'Enter') {
            event.preventDefault();
            const command = matches[active];
            if (command) {
                onClose();
                command.run();
            }
        }
    };

    return (
        <div className="scrim is-top" onMouseDown={onClose}>
            <div
                className="panel palette"
                role="dialog"
                aria-modal="true"
                aria-label="Comandi"
                onMouseDown={(event) => event.stopPropagation()}
            >
                <input
                    ref={inputRef}
                    className="palette-input"
                    placeholder="Esegui un comando…"
                    value={query}
                    spellCheck={false}
                    onChange={(event) => {
                        setQuery(event.target.value);
                        setCursor(0);
                    }}
                    onKeyDown={onKeyDown}
                />
                <ul className="palette-list" role="listbox">
                    {matches.map((command, index) => (
                        <li key={command.id}>
                            <button
                                type="button"
                                role="option"
                                aria-selected={index === active}
                                className={`palette-item${index === active ? ' is-active' : ''}`}
                                onMouseEnter={() => setCursor(index)}
                                onClick={() => {
                                    onClose();
                                    command.run();
                                }}
                            >
                                <span className="palette-label">{command.label}</span>
                                {command.hint && <span className="palette-hint">{command.hint}</span>}
                                {command.chord && <Kbd chord={command.chord} />}
                            </button>
                        </li>
                    ))}
                    {matches.length === 0 && <li className="palette-empty">Nessuna corrispondenza.</li>}
                </ul>
            </div>
        </div>
    );
};
