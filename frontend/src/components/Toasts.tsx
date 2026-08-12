import React, { useEffect } from 'react';

/**
 * Transient messages, bottom-left, out of the grid's way.
 *
 * Errors do not auto-dismiss: the one message that matters — a rename that failed —
 * must still be on screen when the user looks back.
 */

export interface Toast {
    id: string;
    text: string;
    tone: 'info' | 'error';
}

export const Toasts: React.FC<{ toasts: Toast[]; onDismiss: (id: string) => void }> = ({ toasts, onDismiss }) => (
    <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
            <ToastRow key={toast.id} toast={toast} onDismiss={onDismiss} />
        ))}
    </div>
);

const ToastRow: React.FC<{ toast: Toast; onDismiss: (id: string) => void }> = ({ toast, onDismiss }) => {
    useEffect(() => {
        if (toast.tone === 'error') return;
        const timer = setTimeout(() => onDismiss(toast.id), 4000);
        return () => clearTimeout(timer);
    }, [onDismiss, toast.id, toast.tone]);

    return (
        <button type="button" className={`toast is-${toast.tone}`} onClick={() => onDismiss(toast.id)}>
            {toast.text}
        </button>
    );
};
