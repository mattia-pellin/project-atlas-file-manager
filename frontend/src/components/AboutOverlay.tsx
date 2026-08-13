import React, { useEffect } from 'react';
import { BUILD, BUILT_AT, COMMIT, formatBuiltAt, IS_DEV, VERSION } from '../buildinfo';

/**
 * What is running, so it can be compared with what was deployed.
 *
 * The panel exists for one check: after a rebuild, is the tab in front of me the new
 * bundle or the old one? So the build number is the largest thing on it — it is the
 * identifier that moves on every change, where the version only moves on a release —
 * and everything else is context for it. Nothing here is a control; there is nothing
 * to press but Esc.
 */

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div className="about-row">
        <dt>{label}</dt>
        <dd className="mono">{children}</dd>
    </div>
);

export const AboutOverlay: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [onClose]);

    const built = formatBuiltAt(BUILT_AT);

    return (
        <div className="scrim" onMouseDown={onClose}>
            <div
                className="panel about"
                role="dialog"
                aria-modal="true"
                aria-label="Informazioni"
                onMouseDown={(event) => event.stopPropagation()}
            >
                <header className="panel-head">
                    <h2>Informazioni</h2>
                    <button type="button" className="button ghost" onClick={onClose}>
                        Esc
                    </button>
                </header>

                <div className="about-body">
                    {/* Version and build together, because neither answers the question
                        alone: the version says which release, the build says which of
                        the many rebuilds of that release this one is. */}
                    <div className="about-id">
                        <span className="about-name">Project: Atlas — Files</span>
                        <span className="about-version mono">{VERSION}</span>
                        <span className="about-build mono">build {BUILD}</span>
                    </div>

                    <dl className="about-rows">
                        <Row label="Commit">{COMMIT || '—'}</Row>
                        <Row label="Compilato">{built ?? '—'}</Row>
                        <Row label="Ambiente">{IS_DEV ? 'sviluppo (vite)' : 'container'}</Row>
                    </dl>

                    {/* A dev server is not a build and has nothing to identify: saying so
                        beats printing two em-dashes and leaving them to be interpreted. */}
                    {IS_DEV && (
                        <p className="about-note">
                            Il server di sviluppo non lascia impronte: commit e data compaiono solo su una build del
                            container.
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
};
