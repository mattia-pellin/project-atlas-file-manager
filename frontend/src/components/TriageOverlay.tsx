import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CandidateOut, MediaItem } from '../api';
import { matchesChord } from '../lib/keymap';
import { sameSeries } from '../lib/series';

/**
 * Triage: one ambiguity at a time, answered with a digit.
 *
 * The queue is the rows the scoring refused to settle. Nothing here is typed, so
 * bare keys are free — 1–9 pick a candidate, which is the fastest possible answer
 * to "which of these is it".
 *
 * The important part is `applyToSeries`. A season is 10–25 files carrying the exact
 * same ambiguity, and answering "which One Piece?" once has to settle all of them;
 * having to answer it twenty-four more times is what made the previous UI a chore.
 * The replay is free in API terms — the backend caches the raw payloads, so a forced
 * pick by key re-scores from cache rather than searching again.
 */

interface TriageProps {
    rows: MediaItem[];
    queue: MediaItem[];
    startId: string | null;
    onPick: (rows: MediaItem[], candidate: CandidateOut) => void;
    onSkip: (item: MediaItem) => void;
    onClose: () => void;
}

const percent = (value: number): string => `${Math.round(value * 100)}%`;

export const TriageOverlay: React.FC<TriageProps> = ({ rows, queue, startId, onPick, onSkip, onClose }) => {
    const startIndex = Math.max(
        0,
        queue.findIndex((item) => item.id === startId)
    );
    const [index, setIndex] = useState(startIndex);
    const [applyToSeries, setApplyToSeries] = useState(true);

    const item = queue[Math.min(index, queue.length - 1)];
    const candidates = useMemo(() => item?.candidates ?? [], [item]);

    // The rows one answer will settle. Movies group to themselves, by design: two
    // films sharing a title are two different films.
    const affected = useMemo(() => {
        if (!item) return [];
        if (!applyToSeries || item.media_type !== 'episode') return [item];
        return sameSeries(rows, item).filter(
            (row) => row.id === item.id || row.status === 'review' || row.status === 'error' || row.status === 'pending'
        );
    }, [applyToSeries, item, rows]);

    const pick = useCallback(
        (candidate: CandidateOut | undefined) => {
            if (!candidate || !item) return;
            onPick(affected, candidate);
            if (index >= queue.length - 1) onClose();
        },
        [affected, index, item, onClose, onPick, queue.length]
    );

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (matchesChord(event, 'escape')) {
                event.preventDefault();
                onClose();
                return;
            }
            if (matchesChord(event, 'arrowdown') || matchesChord(event, 'arrowright')) {
                event.preventDefault();
                setIndex((current) => Math.min(current + 1, queue.length - 1));
                return;
            }
            if (matchesChord(event, 'arrowup') || matchesChord(event, 'arrowleft')) {
                event.preventDefault();
                setIndex((current) => Math.max(current - 1, 0));
                return;
            }
            if (matchesChord(event, 'a')) {
                event.preventDefault();
                setApplyToSeries((current) => !current);
                return;
            }
            if (matchesChord(event, 's')) {
                event.preventDefault();
                if (item) onSkip(item);
                setIndex((current) => Math.min(current + 1, queue.length - 1));
                return;
            }
            const digit = Number(event.key);
            if (!event.ctrlKey && !event.metaKey && !event.altKey && Number.isInteger(digit) && digit >= 1 && digit <= 9) {
                event.preventDefault();
                pick(candidates[digit - 1]);
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [candidates, item, onClose, onSkip, pick, queue.length]);

    if (!item) {
        return (
            <div className="triage" role="dialog" aria-modal="true" aria-label="Triage">
                <div className="triage-empty">
                    <p>Nothing left to triage.</p>
                    <button type="button" className="button" onClick={onClose}>
                        Back to the grid
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="triage" role="dialog" aria-modal="true" aria-label="Triage">
            <header className="triage-head">
                <div className="triage-progress mono">
                    {index + 1} / {queue.length}
                </div>
                <div className="triage-file">
                    <span className="triage-filename">{item.original_name}</span>
                    {item.message && <span className="triage-message">{item.message}</span>}
                </div>
                <button type="button" className="button ghost" onClick={onClose} aria-label="Close triage (Esc)">
                    Esc
                </button>
            </header>

            <ol className="candidates">
                {candidates.map((candidate, position) => (
                    <li key={candidate.key}>
                        <button
                            type="button"
                            className={`candidate${candidate.selected ? ' is-current' : ''}`}
                            onClick={() => pick(candidate)}
                        >
                            <span className="candidate-index mono">{position + 1}</span>
                            {candidate.poster_url ? (
                                <img className="candidate-poster" src={candidate.poster_url} alt="" loading="lazy" />
                            ) : (
                                <span className="candidate-poster is-empty" aria-hidden="true" />
                            )}
                            <span className="candidate-body">
                                <span className="candidate-label">
                                    {candidate.label}
                                    {candidate.year !== undefined && <span className="candidate-year mono"> {candidate.year}</span>}
                                </span>
                                {candidate.overview && <span className="candidate-overview">{candidate.overview}</span>}
                            </span>
                            <span className="candidate-score" title={`title ${percent(candidate.title_score)} × year ${candidate.year_factor.toFixed(2)}`}>
                                <span className="mono">{percent(candidate.score)}</span>
                                <span className="candidate-bar" aria-hidden="true">
                                    <span style={{ width: percent(candidate.score) }} />
                                </span>
                            </span>
                        </button>
                    </li>
                ))}
                {candidates.length === 0 && <li className="candidate-none">No candidate was returned for this file.</li>}
            </ol>

            <footer className="triage-foot">
                <label className={`apply-series${item.media_type !== 'episode' ? ' is-disabled' : ''}`}>
                    <input
                        type="checkbox"
                        checked={applyToSeries && item.media_type === 'episode'}
                        disabled={item.media_type !== 'episode'}
                        onChange={(event) => setApplyToSeries(event.target.checked)}
                    />
                    <span>
                        Apply to the whole series
                        <kbd>A</kbd>
                    </span>
                    <span className="apply-count">
                        {item.media_type === 'episode'
                            ? `${affected.length} file${affected.length === 1 ? '' : 's'} will be re-analyzed`
                            : 'movies are settled one at a time'}
                    </span>
                </label>
                <div className="triage-hints">
                    <span>
                        <kbd>1</kbd>–<kbd>9</kbd> pick
                    </span>
                    <span>
                        <kbd>↑</kbd>
                        <kbd>↓</kbd> other files
                    </span>
                    <span>
                        <kbd>S</kbd> skip
                    </span>
                </div>
            </footer>
        </div>
    );
};
