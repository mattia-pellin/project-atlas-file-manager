import React, { useEffect, useRef } from 'react';
import { MediaItem } from '../api';

/**
 * The last thing between a decision and the filesystem.
 *
 * It shows the exact old and new name of every file, because that is the only thing
 * that can actually be checked: a wrong name here does not raise an error, it
 * scatters files into a Plex library the user then has to repair by hand. Nothing is
 * summarised or elided — if forty files are about to move, forty lines are shown.
 */

interface ConfirmProps {
    items: MediaItem[];
    onConfirm: () => void;
    onCancel: () => void;
}

export const ConfirmRename: React.FC<ConfirmProps> = ({ items, onConfirm, onCancel }) => {
    const confirmRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        confirmRef.current?.focus();
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onCancel();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [onCancel]);

    const risky = items.filter((item) => item.status === 'review' || item.confidence === undefined);

    return (
        <div className="scrim" onMouseDown={onCancel}>
            <div
                className="panel confirm"
                role="dialog"
                aria-modal="true"
                aria-label="Confirm rename"
                onMouseDown={(event) => event.stopPropagation()}
            >
                <header className="panel-head">
                    <h2>
                        Rename {items.length} file{items.length === 1 ? '' : 's'}
                    </h2>
                    <button type="button" className="button ghost" onClick={onCancel}>
                        Esc
                    </button>
                </header>

                {risky.length > 0 && (
                    <p className="confirm-warning">
                        {risky.length} of these was never confidently matched. Check {risky.length === 1 ? 'it' : 'them'} before
                        going ahead — renaming is not undone for you.
                    </p>
                )}

                <ol className="confirm-list">
                    {items.map((item) => (
                        <li key={item.id}>
                            <span className="confirm-from mono">{item.original_name}</span>
                            <span className="confirm-arrow" aria-hidden="true">
                                →
                            </span>
                            <span className="confirm-to mono">{item.proposed_name}</span>
                        </li>
                    ))}
                </ol>

                <footer className="panel-foot">
                    <div className="spacer" />
                    <button type="button" className="button ghost" onClick={onCancel}>
                        Cancel
                    </button>
                    <button type="button" className="button primary" ref={confirmRef} onClick={onConfirm}>
                        Rename
                    </button>
                </footer>
            </div>
        </div>
    );
};
