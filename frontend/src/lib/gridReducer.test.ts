import { describe, expect, it } from 'vitest';
import { MediaItem } from '../api';
import { columnIndex } from './columns';
import { GridAction, gridReducer, GridState, initialGridState, rangeRowIds } from './gridReducer';
import { ReplaceRequest } from './replace';

/**
 * The reducer is the whole keyboard model, so these tests are the specification of
 * what each key does. They matter more than most UI tests: the rows they mutate end
 * up as filenames in a real Plex library, and a fill-down that writes into the wrong
 * column is a silent, forty-file mistake.
 */

const TITLE = columnIndex('clean_title');
const EPISODE = columnIndex('episode');
const PROPOSED = columnIndex('proposed_name');
const STATUS = columnIndex('status');

const row = (overrides: Partial<MediaItem> = {}): MediaItem => ({
    id: '1',
    original_path: '/media/Show.S01E01.mkv',
    original_name: 'Show.S01E01.mkv',
    media_type: 'episode',
    clean_title: 'Show',
    season: 1,
    episode: 1,
    proposed_name: 'Show - S01E01.mkv',
    status: 'matched',
    confidence: 0.9,
    ...overrides
});

const season = (count: number): MediaItem[] =>
    Array.from({ length: count }, (_, index) =>
        row({
            id: String(index + 1),
            original_name: `Show.S01E0${index + 1}.mkv`,
            episode: index + 1,
            proposed_name: `Show - S01E0${index + 1}.mkv`
        })
    );

const run = (state: GridState, ...actions: GridAction[]): GridState => actions.reduce(gridReducer, state);

describe('focus', () => {
    it('starts on the first row and on the name column', () => {
        const state = initialGridState(season(3));
        expect(state.focusRowId).toBe('1');
        expect(state.focusColumn).toBe(columnIndex('original_name'));
    });

    it('stops at the edges instead of wrapping', () => {
        const state = run(initialGridState(season(3)), { type: 'move', rows: -5, columns: -5 });
        expect(state.focusRowId).toBe('1');
        expect(state.focusColumn).toBe(0);

        const bottom = run(initialGridState(season(3)), { type: 'moveEdge', edge: 'bottom' });
        expect(bottom.focusRowId).toBe('3');
    });

    it('follows the row, not its position, when the rows are replaced', () => {
        const rows = season(3);
        const state = run(initialGridState(rows), { type: 'move', rows: 2, columns: 0 });
        expect(state.focusRowId).toBe('3');

        // A rescan that returns the same files in a different order must not move the
        // cursor onto a different file.
        const reordered = run(state, { type: 'setRows', rows: [rows[2], rows[0], rows[1]] });
        expect(reordered.focusRowId).toBe('3');
    });
});

describe('editing', () => {
    it('replaces the cell when you start typing, as a spreadsheet does', () => {
        const state = run(initialGridState([row()]), { type: 'focusCell', rowId: '1', column: TITLE }, { type: 'beginEdit', initial: 'B' });
        expect(state.editing).toEqual({ rowId: '1', column: TITLE, draft: 'B' });
    });

    it('keeps the existing value when opened with F2 or Enter', () => {
        const state = run(initialGridState([row()]), { type: 'focusCell', rowId: '1', column: TITLE }, { type: 'beginEdit' });
        expect(state.editing?.draft).toBe('Show');
    });

    it('commits and steps down, so a column can be typed straight through', () => {
        const state = run(
            initialGridState(season(2)),
            { type: 'focusCell', rowId: '1', column: TITLE },
            { type: 'beginEdit', initial: 'Breaking Bad' },
            { type: 'commitEdit', then: 'down' }
        );
        expect(state.rows[0].clean_title).toBe('Breaking Bad');
        expect(state.focusRowId).toBe('2');
    });

    it('drops the row back to pending when an input the name was derived from changes', () => {
        const state = run(
            initialGridState([row()]),
            { type: 'focusCell', rowId: '1', column: TITLE },
            { type: 'beginEdit', initial: 'Other' },
            { type: 'commitEdit' }
        );
        expect(state.rows[0].status).toBe('pending');
        expect(state.rows[0].confidence).toBeUndefined();
    });

    it('leaves the status alone when the name itself is hand-written', () => {
        const state = run(
            initialGridState([row()]),
            { type: 'focusCell', rowId: '1', column: PROPOSED },
            { type: 'beginEdit', initial: 'Show - S01E01 - Pilot.mkv' },
            { type: 'commitEdit' }
        );
        expect(state.rows[0].proposed_name).toBe('Show - S01E01 - Pilot.mkv');
        expect(state.rows[0].status).toBe('matched');
        expect(state.rows[0].confidence).toBe(0.9);
    });

    it('keeps an episode range as typed', () => {
        const state = run(
            initialGridState([row()]),
            { type: 'focusCell', rowId: '1', column: EPISODE },
            { type: 'beginEdit', initial: '10-12' },
            { type: 'commitEdit' }
        );
        expect(state.rows[0].episode).toBe('10-12');
    });

    it('refuses to edit a column that is not editable', () => {
        const state = run(initialGridState([row()]), { type: 'focusCell', rowId: '1', column: STATUS }, { type: 'beginEdit' });
        expect(state.editing).toBeNull();
    });

    it('abandons the draft on cancel', () => {
        const state = run(
            initialGridState([row()]),
            { type: 'focusCell', rowId: '1', column: TITLE },
            { type: 'beginEdit', initial: 'Wrong' },
            { type: 'cancelEdit' }
        );
        expect(state.rows[0].clean_title).toBe('Show');
        expect(state.editing).toBeNull();
    });
});

/**
 * Editing a row is how a match is corrected by hand, so the reducer has to say which
 * rows the shell must ask the API about again. There is no bulk re-match command to
 * fall back on: get this wrong and a corrected title keeps the name it contradicts.
 */
describe('re-matching', () => {
    it('marks the row stale when an input changes', () => {
        const state = run(
            initialGridState([row()]),
            { type: 'focusCell', rowId: '1', column: TITLE },
            { type: 'beginEdit', initial: 'Breaking Bad' },
            { type: 'commitEdit' }
        );
        expect(state.staleRowIds).toEqual(['1']);
    });

    it('does not, when the name is written by hand', () => {
        const state = run(
            initialGridState([row()]),
            { type: 'focusCell', rowId: '1', column: PROPOSED },
            { type: 'beginEdit', initial: 'Show - S01E01 - Pilot.mkv' },
            { type: 'commitEdit' }
        );
        expect(state.staleRowIds).toEqual([]);
    });

    it('marks every row a fill-down touched, once each', () => {
        const state = run(
            initialGridState(season(3)),
            { type: 'selectAll' },
            { type: 'focusCell', rowId: '1', column: TITLE },
            { type: 'beginEdit', initial: 'Breaking Bad' },
            { type: 'commitEdit' },
            { type: 'fillDown' }
        );
        expect(state.staleRowIds).toEqual(['2', '3']);
    });

    it('marks the row again when the edit is undone — the old title has to be matched too', () => {
        const state = run(
            initialGridState([row()]),
            { type: 'focusCell', rowId: '1', column: TITLE },
            { type: 'beginEdit', initial: 'Breaking Bad' },
            { type: 'commitEdit' },
            { type: 'clearStale' },
            { type: 'undo' }
        );
        expect(state.rows[0].clean_title).toBe('Show');
        expect(state.staleRowIds).toEqual(['1']);
    });

    it('is emptied by the shell once it has asked, and by a rescan', () => {
        const edited = run(
            initialGridState([row()]),
            { type: 'focusCell', rowId: '1', column: TITLE },
            { type: 'beginEdit', initial: 'Breaking Bad' },
            { type: 'commitEdit' }
        );
        expect(run(edited, { type: 'clearStale' }).staleRowIds).toEqual([]);
        expect(run(edited, { type: 'setRows', rows: [row()] }).staleRowIds).toEqual([]);
    });
});

describe('selection', () => {
    it('refuses a row that could not be renamed, and says why', () => {
        const invalid = row({ episode: 'not-an-episode' });
        const state = run(initialGridState([invalid]), { type: 'toggleSelection' });
        expect(state.selected.size).toBe(0);
        expect(state.notice).toMatch(/non è ancora rinominabile/);
    });

    it('refuses a row nothing was found for, and does not send the user hunting for a red cell', () => {
        const unmatched = row({ proposed_name: null, status: 'error', confidence: undefined });
        const state = run(initialGridState([unmatched]), { type: 'toggleSelection' });
        expect(state.selected.size).toBe(0);
        expect(state.notice).toMatch(/Nessun nome proposto/);
    });

    it('leaves an unmatched row out of select-all', () => {
        const rows = [row({ id: '1' }), row({ id: '2', proposed_name: null, status: 'error' })];
        const state = run(initialGridState(rows), { type: 'selectAll' });
        expect([...state.selected]).toEqual(['1']);
        expect(state.notice).toMatch(/1 riga saltata/);
    });

    it('extends from the anchor over valid rows only', () => {
        const rows = [row({ id: '1' }), row({ id: '2', episode: 'nope' }), row({ id: '3' })];
        const state = run(initialGridState(rows), { type: 'move', rows: 2, columns: 0, extend: true });
        expect([...state.selected].sort()).toEqual(['1', '3']);
    });

    it('toggles select-all off once everything valid is ticked', () => {
        const state = run(initialGridState(season(3)), { type: 'selectAll' });
        expect(state.selected.size).toBe(3);
        expect(gridReducer(state, { type: 'selectAll' }).selected.size).toBe(0);
    });

    it('drops the selection when the rows are replaced', () => {
        // A tick carried across a rescan would rename a file nobody looked at.
        const state = run(initialGridState(season(3)), { type: 'selectAll' }, { type: 'setRows', rows: season(3) });
        expect(state.selected.size).toBe(0);
    });
});

describe('fill down', () => {
    it('writes the focused cell into every selected row, in one transaction', () => {
        const state = run(
            initialGridState(season(3)),
            { type: 'focusCell', rowId: '1', column: TITLE },
            { type: 'setSelection', ids: ['2', '3'] },
            { type: 'beginEdit', initial: 'Breaking Bad' },
            { type: 'commitEdit', then: 'stay' },
            { type: 'fillDown' }
        );
        expect(state.rows.map((item) => item.clean_title)).toEqual(['Breaking Bad', 'Breaking Bad', 'Breaking Bad']);

        // One keystroke put it there, so one keystroke has to take it back.
        const undone = gridReducer(state, { type: 'undo' });
        expect(undone.rows.map((item) => item.clean_title)).toEqual(['Breaking Bad', 'Show', 'Show']);
    });

    it('says what to do instead of silently doing nothing', () => {
        const state = run(initialGridState(season(3)), { type: 'focusCell', rowId: '1', column: TITLE }, { type: 'fillDown' });
        expect(state.notice).toMatch(/Seleziona prima le righe/);
    });

    it('never touches a column other than the focused one', () => {
        const state = run(
            initialGridState(season(3)),
            { type: 'focusCell', rowId: '1', column: TITLE },
            { type: 'setSelection', ids: ['2', '3'] },
            { type: 'fillDown' }
        );
        expect(state.rows.map((item) => item.episode)).toEqual([1, 2, 3]);
    });

    it('prefers the extended range over the tick set when there is one', () => {
        // The two are different intents: the ticks are the rename queue and can hold rows
        // far from the cursor, while an extended range is what the user just drew.
        const state = run(
            initialGridState(season(4)),
            { type: 'focusCell', rowId: '1', column: TITLE },
            { type: 'setSelection', ids: ['4'] },
            { type: 'move', rows: 1, columns: 0, extend: true },
            { type: 'fillDown' }
        );
        expect(state.rows.map((item) => item.clean_title)).toEqual(['Show', 'Show', 'Show', 'Show']);
        expect(state.rows[3].status).toBe('matched');
    });
});

describe('vertical cell range', () => {
    it('is one row until the cursor is extended', () => {
        const state = run(initialGridState(season(3)), { type: 'focusCell', rowId: '2', column: TITLE });
        expect(rangeRowIds(state)).toEqual(['2']);
    });

    it('runs anchor-to-focus whichever way it was drawn', () => {
        const down = run(
            initialGridState(season(4)),
            { type: 'focusCell', rowId: '2', column: TITLE },
            { type: 'move', rows: 2, columns: 0, extend: true }
        );
        expect(rangeRowIds(down)).toEqual(['2', '3', '4']);

        const up = run(
            initialGridState(season(4)),
            { type: 'focusCell', rowId: '3', column: TITLE },
            { type: 'move', rows: -2, columns: 0, extend: true }
        );
        expect(rangeRowIds(up)).toEqual(['1', '2', '3']);
    });

    it('pastes one clipboard into every cell of the range, as one undo', () => {
        const state = run(
            initialGridState(season(3)),
            { type: 'focusCell', rowId: '1', column: TITLE },
            { type: 'move', rows: 2, columns: 0, extend: true },
            { type: 'pasteCell', text: 'Breaking Bad' }
        );
        expect(state.rows.map((item) => item.clean_title)).toEqual(['Breaking Bad', 'Breaking Bad', 'Breaking Bad']);
        // An edited input column invalidates the proposal derived from it.
        expect(state.rows.map((item) => item.status)).toEqual(['pending', 'pending', 'pending']);
        expect([...state.staleRowIds].sort()).toEqual(['1', '2', '3']);

        const undone = gridReducer(state, { type: 'undo' });
        expect(undone.rows.map((item) => item.clean_title)).toEqual(['Show', 'Show', 'Show']);
    });

    it('empties every cell of the range on delete', () => {
        const state = run(
            initialGridState(season(3)),
            { type: 'focusCell', rowId: '2', column: TITLE },
            { type: 'move', rows: 1, columns: 0, extend: true },
            { type: 'clearCell' }
        );
        expect(state.rows.map((item) => item.clean_title)).toEqual(['Show', undefined, undefined]);
    });

    it('refuses a column that cannot be written', () => {
        // `writeRange` is the last gate before a value that would reach the backend, so a
        // read-only column has to be a no-op rather than a silently dropped patch.
        const before = run(
            initialGridState(season(3)),
            { type: 'focusCell', rowId: '1', column: STATUS },
            { type: 'move', rows: 2, columns: 0, extend: true }
        );
        const after = gridReducer(before, { type: 'pasteCell', text: 'matched' });
        expect(after.rows).toEqual(before.rows);
    });
});

describe('undo', () => {
    it('restores the previous value and can be redone', () => {
        const edited = run(
            initialGridState([row()]),
            { type: 'focusCell', rowId: '1', column: TITLE },
            { type: 'beginEdit', initial: 'Wrong' },
            { type: 'commitEdit', then: 'stay' }
        );
        const undone = gridReducer(edited, { type: 'undo' });
        expect(undone.rows[0].clean_title).toBe('Show');
        expect(gridReducer(undone, { type: 'redo' }).rows[0].clean_title).toBe('Wrong');
    });

    it('reports an empty history rather than doing nothing', () => {
        expect(gridReducer(initialGridState([row()]), { type: 'undo' }).notice).toBe('Niente da annullare');
    });
});

describe('cycling a choice cell', () => {
    const TYPE = columnIndex('media_type');

    it('flips the type without opening an editor', () => {
        // The cell used to be a `<select>` reached by typing, which put the typed
        // character in the draft, matched no option, and looked inert.
        const state = run(initialGridState([row()]), { type: 'focusCell', rowId: '1', column: TYPE }, { type: 'cycleChoice' });
        expect(state.rows[0].media_type).toBe('movie');
        expect(state.editing).toBeNull();
        expect(gridReducer(state, { type: 'cycleChoice' }).rows[0].media_type).toBe('episode');
    });

    it('lands on the first choice from a value that is neither', () => {
        const state = run(
            initialGridState([row({ media_type: 'unknown' })]),
            { type: 'focusCell', rowId: '1', column: TYPE },
            { type: 'cycleChoice' }
        );
        expect(state.rows[0].media_type).toBe('movie');
    });

    it('re-matches the row, because the type decides which API is asked', () => {
        const state = run(initialGridState([row()]), { type: 'focusCell', rowId: '1', column: TYPE }, { type: 'cycleChoice' });
        expect(state.rows[0].status).toBe('pending');
        expect(state.staleRowIds).toEqual(['1']);
    });

    it('does nothing on a column that has no choices', () => {
        const state = run(initialGridState([row()]), { type: 'focusCell', rowId: '1', column: TITLE }, { type: 'cycleChoice' });
        expect(state.rows[0].clean_title).toBe('Show');
        expect(state.staleRowIds).toEqual([]);
    });

    // What the Alt+T chord does: the cursor is almost never parked on Type when the type
    // turns out to be wrong, and walking to that column first is the tax the chord removes.
    it('flips the named column whatever the cursor is on', () => {
        const state = run(
            initialGridState([row()]),
            { type: 'focusCell', rowId: '1', column: PROPOSED },
            { type: 'cycleChoice', column: TYPE }
        );
        expect(state.rows[0].media_type).toBe('movie');
        expect(state.focusColumn).toBe(PROPOSED);
        expect(state.staleRowIds).toEqual(['1']);
    });
});

/**
 * The order is the data's, not the view's, so the reducer owns it — a table sorted only
 * on screen would leave the keyboard model walking the rows in a different order from
 * the one the user can see.
 */
describe('order', () => {
    const film = (id: string, title: string): MediaItem =>
        row({ id, original_name: `${title}.mkv`, media_type: 'movie', clean_title: title, season: undefined, episode: undefined });

    it('sorts a scan: movies first, then by title', () => {
        const state = gridReducer(initialGridState([]), {
            type: 'setRows',
            rows: [row({ id: 'ep', clean_title: 'Alpha' }), film('m2', 'Zulu'), film('m1', 'Bravo')]
        });
        expect(state.rows.map((item) => item.id)).toEqual(['m1', 'm2', 'ep']);
    });

    it('keeps the cursor on the same file when the sort moves it', () => {
        const rows = [film('m2', 'Zulu'), film('m1', 'Bravo')];
        const state = run(initialGridState([]), { type: 'setRows', rows }, { type: 'focusCell', rowId: 'm2', column: TITLE });
        expect(state.rows[0].id).toBe('m1');
        expect(state.focusRowId).toBe('m2');
    });

    // Analysis rewrites the title and the year, so the shell re-sorts once a batch is in.
    // Doing it inside `mergeRows` would shuffle the grid under a user who is typing in it.
    it('leaves a merged row where it was until the shell asks for a sort', () => {
        const start = gridReducer(initialGridState([]), { type: 'setRows', rows: [film('m1', 'Bravo'), film('m2', 'Zulu')] });
        const merged = gridReducer(start, { type: 'mergeRows', rows: [film('m1', 'Zzz')] });
        expect(merged.rows.map((item) => item.id)).toEqual(['m1', 'm2']);
        expect(gridReducer(merged, { type: 'sort' }).rows.map((item) => item.id)).toEqual(['m2', 'm1']);
    });
});

describe('merge', () => {
    it('replaces analyzed rows in place and leaves the rest alone', () => {
        const state = run(initialGridState(season(3)), {
            type: 'mergeRows',
            rows: [row({ id: '2', clean_title: 'Analyzed', status: 'review' })]
        });
        expect(state.rows.map((item) => item.clean_title)).toEqual(['Show', 'Analyzed', 'Show']);
        expect(state.rows[1].status).toBe('review');
    });
});

/**
 * Find and replace. The reducer's part of it is narrow — the matching is pure and lives
 * in `replace.ts` — but these three properties are what make it safe to point at forty
 * names at once.
 */
describe('find and replace', () => {
    const request = (over: Partial<ReplaceRequest> = {}): ReplaceRequest => ({
        find: 'Show',
        replace: 'Spettacolo',
        matchCase: true,
        scope: 'all',
        ...over
    });

    it('rewrites every matching proposal in the table', () => {
        const state = run(initialGridState(season(3)), { type: 'replaceInNames', request: request() });
        expect(state.rows.map((item) => item.proposed_name)).toEqual([
            'Spettacolo - S01E01.mkv',
            'Spettacolo - S01E02.mkv',
            'Spettacolo - S01E03.mkv'
        ]);
        expect(state.notice).toBe('3 nomi sostituiti');
    });

    it('rewrites only the ticked rows when asked to', () => {
        const state = run(
            initialGridState(season(3)),
            { type: 'setSelection', ids: ['2'] },
            { type: 'replaceInNames', request: request({ scope: 'selected' }) }
        );
        expect(state.rows.map((item) => item.proposed_name)).toEqual([
            'Show - S01E01.mkv',
            'Spettacolo - S01E02.mkv',
            'Show - S01E03.mkv'
        ]);
    });

    // Forty names rewritten by a typo in the search box must come back on one Ctrl+Z.
    it('is one transaction, however many names it touched', () => {
        const replaced = run(initialGridState(season(3)), { type: 'replaceInNames', request: request() });
        const undone = gridReducer(replaced, { type: 'undo' });
        expect(undone.rows.map((item) => item.proposed_name)).toEqual([
            'Show - S01E01.mkv',
            'Show - S01E02.mkv',
            'Show - S01E03.mkv'
        ]);
        expect(undone.undo).toEqual([]);
    });

    /**
     * The reason it is confined to `proposed_name`. Touching an input marks the row stale
     * and the shell re-analyses it, which would hand the name straight back to the API and
     * throw the correction away — so a replace must never look like an input edit.
     */
    it('leaves the rows settled: no re-analysis, no lost status', () => {
        const state = run(initialGridState(season(3)), { type: 'replaceInNames', request: request() });
        expect(state.staleRowIds).toEqual([]);
        expect(state.rows.every((item) => item.status === 'matched')).toBe(true);
        expect(state.rows.every((item) => item.confidence === 0.9)).toBe(true);
    });

    it('says so instead of recording an empty transaction when nothing matches', () => {
        const state = run(initialGridState(season(3)), { type: 'replaceInNames', request: request({ find: 'Nulla' }) });
        expect(state.notice).toBe('Nessun nome proposto contiene «Nulla»');
        expect(state.undo).toEqual([]);
        expect(state.rows[0].proposed_name).toBe('Show - S01E01.mkv');
    });
});
