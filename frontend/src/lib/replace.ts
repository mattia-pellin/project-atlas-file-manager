import { MediaItem } from '../api';

/**
 * Find and replace, over the proposed names.
 *
 * The one column it touches is `proposed_name`, deliberately. Everything else in the
 * grid is *input* to the match — editing a title re-runs the analysis and rewrites the
 * proposal — so a bulk replace there would be a bulk re-match, which is the thing this
 * app does not have and must not grow. A proposal, by contrast, is the answer: the user
 * is allowed to write it by hand, one cell at a time today and forty at a time here.
 *
 * Literal, never a regular expression. A pattern is the wrong amount of power for
 * something that writes to a Plex library: one stray `.` and every character of forty
 * names is a match, and the mistake is not visible in the pattern that caused it.
 *
 * Pure, so the panel can preview exactly what the reducer will apply — the count on
 * screen and the transaction are the same function, not two readings of one intent.
 */

/** Which rows are in play: everything in the grid, or only the ticked ones. */
export type ReplaceScope = 'all' | 'selected';

export interface ReplaceRequest {
    find: string;
    replace: string;
    /**
     * Case-sensitive by default, which is not the spreadsheet default and is on purpose:
     * half of what gets corrected here *is* the capitalisation — "S.H.i.e.L.D." for
     * "S.H.I.E.L.D." — and a search that ignores case cannot express that at all.
     */
    matchCase: boolean;
    scope: ReplaceScope;
}

export interface Replacement {
    id: string;
    before: string;
    after: string;
}

const escapeForRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Every occurrence, replaced literally.
 *
 * The replacement is handed over as a function so the `$&`, `$1` and `$$` that
 * `String.replace` would otherwise expand stay the characters the user typed. Nobody
 * writing a Plex name means a backreference.
 */
export const replaceEvery = (text: string, find: string, replace: string, matchCase: boolean): string => {
    if (!find) return text;
    return text.replace(new RegExp(escapeForRegExp(find), matchCase ? 'g' : 'gi'), () => replace);
};

/**
 * What the request would change, row by row, in grid order.
 *
 * Rows with no proposal are skipped: there is nothing to rewrite, and a row that gains
 * a name this way would be one the API never agreed to. Rows the replacement leaves
 * untouched are skipped too, so the count on the panel is the count of files affected.
 */
export const replacementsFor = (
    rows: readonly MediaItem[],
    selected: ReadonlySet<string>,
    request: ReplaceRequest
): Replacement[] => {
    if (!request.find) return [];
    const inScope = request.scope === 'selected' ? rows.filter((row) => selected.has(row.id)) : rows;

    const edits: Replacement[] = [];
    for (const row of inScope) {
        const before = row.proposed_name;
        if (!before) continue;
        const after = replaceEvery(before, request.find, request.replace, request.matchCase);
        if (after !== before) edits.push({ id: row.id, before, after });
    }
    return edits;
};
