import { MediaItem } from '../api';

/**
 * Row-level validation for the editable DataGrid.
 *
 * A row that fails `isRowValid` cannot be selected, and therefore cannot be
 * renamed. These predicates are the last line of defence before the backend
 * touches the filesystem, so they are kept pure and unit-tested.
 */

export const isSeasonValid = (season: unknown): boolean => {
    if (season === undefined || season === null || season === '') return true;
    const num = Number(season);
    return Number.isInteger(num) && num >= 0 && num <= 99;
};

export const isEpisodeValid = (episode: unknown): boolean => {
    if (episode === undefined || episode === null || episode === '') return false;
    if (typeof episode === 'number') {
        return Number.isInteger(episode) && episode >= 1 && episode <= 9999;
    }
    const str = String(episode).trim();
    if (!str) return false;

    if (/^\d+$/.test(str)) {
        const num = parseInt(str, 10);
        return num >= 1 && num <= 9999;
    }

    // Multi-episode range, e.g. "10-12"
    const match = str.match(/^(\d+)-(\d+)$/);
    if (match) {
        const start = parseInt(match[1], 10);
        const end = parseInt(match[2], 10);
        return start >= 1 && start <= 9999 && end >= 1 && end <= 9999 && start < end;
    }

    return false;
};

export const isYearValid = (year: unknown): boolean => {
    if (year === undefined || year === null || year === '') return true;
    const num = Number(year);
    return Number.isInteger(num) && num >= 1900 && num <= 2100;
};

export const isRowValid = (row: MediaItem): boolean => {
    if (row.original_name === row.proposed_name) return false;
    if (row.media_type !== 'movie' && row.media_type !== 'episode') return false;
    if (!isYearValid(row.year)) return false;
    if (row.media_type === 'episode') {
        if (!isSeasonValid(row.season)) return false;
        if (!isEpisodeValid(row.episode)) return false;
    }
    return true;
};
