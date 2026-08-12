import { MediaItem } from '../api';

/**
 * Grouping episodes by the series they claim to belong to.
 *
 * This is what makes one triage decision worth making: a season is 10-25 files
 * that are all the same ambiguity, and answering "which One Piece?" once has to
 * settle all of them. Movies are deliberately not grouped — two films sharing a
 * title are two different films, so each is its own decision.
 *
 * Grouped on the *title*, never on the matched id: the rows that need the fix are
 * precisely the ones currently pointing at the wrong series.
 */

const normalize = (text: string): string =>
    text
        .normalize('NFKD')
        // Fold accents, then drop apostrophes rather than splitting on them, so the
        // Italian elisions this library is full of stay one token. Mirrors
        // `backend/matching.py::normalize_title`.
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/['’ʼ]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

/** The grouping key, or null for anything that is not an episode. */
export const seriesKey = (item: MediaItem): string | null => {
    if (item.media_type !== 'episode') return null;
    const key = normalize(item.clean_title ?? '');
    return key === '' ? null : key;
};

/** Every row that belongs to the same series as `target`, including `target` itself. */
export const sameSeries = (rows: MediaItem[], target: MediaItem): MediaItem[] => {
    const key = seriesKey(target);
    if (key === null) return rows.filter((row) => row.id === target.id);
    return rows.filter((row) => seriesKey(row) === key);
};

/** Rows the scoring could not settle on its own, in grid order. */
export const needsTriage = (rows: MediaItem[]): MediaItem[] =>
    rows.filter((row) => (row.status === 'review' || row.status === 'error') && (row.candidates?.length ?? 0) > 0);
