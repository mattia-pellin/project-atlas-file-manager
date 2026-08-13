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

/**
 * Why this row cannot be ticked, in the words the grid prints — or `null` if it can.
 *
 * One function rather than a boolean plus a message written somewhere else: the three
 * refusals have genuinely different fixes, and "correggi le celle evidenziate" is a lie
 * on a row where nothing is highlighted because the API simply found nothing.
 */
export const rowRefusal = (row: MediaItem): string | null => {
    // Nothing to rename *to*. A row the API refused, or one whose proposed name was
    // deleted by hand, is not a candidate for anything — and this has to be checked
    // here rather than at the moment of renaming, because the tick is what the user
    // reads as "this file is going to be written". Ctrl+A goes through the same gate.
    if (!row.proposed_name || row.proposed_name.trim() === '') {
        return 'Nessun nome proposto — abbina la riga o scrivi il nome prima di spuntarla';
    }
    // Already named that way: renaming it is a no-op, and `resolve_rename_target`
    // refuses it on the backend too. The row carries `success` for exactly this reason.
    if (row.original_name === row.proposed_name) return 'Il file è già nominato così — niente da rinominare';
    if (row.media_type !== 'movie' && row.media_type !== 'episode') {
        return 'Tipo non deciso — scegli film o episodio, con Alt+C';
    }
    if (!isYearValid(row.year)) return 'Questa riga non è ancora rinominabile — correggi prima le celle evidenziate';
    if (row.media_type === 'episode' && (!isSeasonValid(row.season) || !isEpisodeValid(row.episode))) {
        return 'Questa riga non è ancora rinominabile — correggi prima le celle evidenziate';
    }
    return null;
};

export const isRowValid = (row: MediaItem): boolean => rowRefusal(row) === null;
