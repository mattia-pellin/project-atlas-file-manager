import { MediaItem } from '../api';

/**
 * The order the grid is always in.
 *
 * Movies first, then episodes; inside that, by title, year, season and episode. It is
 * not a view-only shuffle: the reducer reorders the data itself, so the keyboard model
 * and the screen cannot disagree about which row is below the cursor.
 *
 * The comparator is total on purpose — it ends at the on-disk name and then the id — so
 * two rows that tie on every visible field still land in the same order every time.
 * A sort that is only *nearly* total lets rows swap places on an unrelated re-render,
 * which in a grid you rename from is indistinguishable from the app losing your place.
 */

const TYPE_ORDER: Record<string, number> = { movie: 0, episode: 1 };

/** Anything that is neither goes last: it is a row that has to be corrected anyway. */
const typeRank = (item: MediaItem): number => TYPE_ORDER[item.media_type] ?? 2;

/**
 * A field that is a number, a range like `"10-12"`, or nothing at all, as one number.
 *
 * Missing sorts last rather than first: an unparsed year is not "year zero", and
 * floating those rows to the top of their title would bury the ones that are ready.
 */
const numberOf = (value: number | string | null | undefined): number => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
    if (typeof value === 'string') {
        const digits = /^\d+/.exec(value.trim());
        if (digits) return Number(digits[0]);
    }
    return Number.POSITIVE_INFINITY;
};

// Infinity - Infinity is NaN, and a comparator that returns NaN sorts arbitrarily.
const byNumber = (a: number, b: number): number => (a === b ? 0 : a < b ? -1 : 1);

/**
 * Accent- and case-insensitive, and numeric so `Season 2` precedes `Season 10`.
 * The locale is pinned rather than taken from the browser: the order of a media
 * library should not depend on which machine is looking at it.
 */
const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

export const compareRows = (a: MediaItem, b: MediaItem): number =>
    byNumber(typeRank(a), typeRank(b)) ||
    collator.compare(a.clean_title ?? '', b.clean_title ?? '') ||
    byNumber(numberOf(a.year), numberOf(b.year)) ||
    byNumber(numberOf(a.season), numberOf(b.season)) ||
    byNumber(numberOf(a.episode), numberOf(b.episode)) ||
    collator.compare(a.original_name, b.original_name) ||
    collator.compare(a.id, b.id);

export const sortRows = (rows: readonly MediaItem[]): MediaItem[] => [...rows].sort(compareRows);
