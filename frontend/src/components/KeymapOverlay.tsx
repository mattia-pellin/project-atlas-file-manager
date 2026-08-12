import React, { useEffect } from 'react';
import { formatChord } from '../lib/keymap';
import { SHORTCUTS } from '../lib/shortcuts';

/** The keymap, rendered from the same strings the handlers match against. */
export const KeymapOverlay: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [onClose]);

    return (
        <div className="scrim" onMouseDown={onClose}>
            <div
                className="panel keymap"
                role="dialog"
                aria-modal="true"
                aria-label="Keyboard shortcuts"
                onMouseDown={(event) => event.stopPropagation()}
            >
                <header className="panel-head">
                    <h2>Keyboard</h2>
                    <button type="button" className="button ghost" onClick={onClose}>
                        Esc
                    </button>
                </header>
                <div className="keymap-groups">
                    {SHORTCUTS.map((group) => (
                        <section key={group.title}>
                            <h3>{group.title}</h3>
                            <dl>
                                {group.shortcuts.map((shortcut) => (
                                    <div key={`${group.title}-${shortcut.chord}`} className="keymap-row">
                                        <dt>
                                            <kbd>{formatChord(shortcut.chord)}</kbd>
                                        </dt>
                                        <dd>{shortcut.what}</dd>
                                    </div>
                                ))}
                            </dl>
                        </section>
                    ))}
                </div>
            </div>
        </div>
    );
};
