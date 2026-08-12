import { describe, expect, it } from 'vitest';
import { MediaItem } from '../api';
import { columnIndex } from './columns';
import { GridAction, gridReducer, GridState, initialGridState } from './gridReducer';

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
        expect(state.notice).toMatch(/cannot be renamed/);
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
        expect(state.notice).toMatch(/Select the rows/);
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
        expect(gridReducer(initialGridState([row()]), { type: 'undo' }).notice).toBe('Nothing to undo');
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
