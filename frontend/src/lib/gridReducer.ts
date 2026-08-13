import { MediaItem } from '../api';
import { COLUMNS, ColumnSpec, columnIndex, EditableField, parseCell } from './columns';
import { ReplaceRequest, replacementsFor } from './replace';
import { sortRows } from './sort';
import { isRowValid, rowRefusal } from './validation';

/**
 * Every keyboard interaction the grid has, as one pure reducer.
 *
 * It is pure and separate from the rendering on purpose. This is the part of the
 * app the user actually operates — the predecessor was a spreadsheet and the whole
 * point of the redesign is to get that fluency back — so it has to be testable
 * without a DOM, and it has to be the single place that decides what a key does.
 *
 * Focus is stored as a *row id*, not a row index: rows get re-sorted and replaced
 * by analysis results, and an index would quietly point at a different file.
 */

export interface EditState {
    rowId: string;
    column: number;
    draft: string;
}

interface Patch {
    id: string;
    field: EditableField;
    before: unknown;
    after: unknown;
}

export interface GridState {
    rows: MediaItem[];
    focusRowId: string | null;
    focusColumn: number;
    editing: EditState | null;
    selected: ReadonlySet<string>;
    /** Where a shift-extended selection started. */
    anchorRowId: string | null;
    /** Transactions, so a fill-down over 40 rows undoes in one keystroke. */
    undo: Patch[][];
    redo: Patch[][];
    /** Set by actions that have something to say; the shell drains it into a toast. */
    notice: string | null;
    /**
     * Rows whose inputs were just edited, so the proposal they carried no longer
     * follows from them. The shell drains this and re-matches exactly these rows —
     * it is the only re-analysis there is, and it is why there is no "match
     * everything again" command to overwrite a hand-picked answer with a guess.
     */
    staleRowIds: string[];
}

export type GridAction =
    | { type: 'setRows'; rows: MediaItem[] }
    | { type: 'mergeRows'; rows: MediaItem[] }
    | { type: 'focusCell'; rowId: string; column: number }
    | { type: 'move'; rows: number; columns: number; extend?: boolean }
    | { type: 'moveEdge'; edge: 'top' | 'bottom' | 'first' | 'last' }
    | { type: 'beginEdit'; initial?: string }
    | { type: 'changeDraft'; draft: string }
    | { type: 'commitEdit'; then?: 'down' | 'right' | 'stay' }
    | { type: 'cancelEdit' }
    | { type: 'setCell'; rowId: string; column: number; text: string }
    | { type: 'toggleSelection' }
    | { type: 'selectAll' }
    | { type: 'clearSelection' }
    | { type: 'setSelection'; ids: string[] }
    | { type: 'fillDown' }
    | { type: 'cycleChoice'; column?: number }
    | { type: 'sort' }
    | { type: 'clearCell' }
    | { type: 'pasteCell'; text: string }
    | { type: 'replaceInNames'; request: ReplaceRequest }
    | { type: 'undo' }
    | { type: 'redo' }
    | { type: 'dismissNotice' }
    | { type: 'clearStale' };

export const initialGridState = (rows: MediaItem[] = []): GridState => ({
    rows,
    focusRowId: rows[0]?.id ?? null,
    focusColumn: 1,
    editing: null,
    selected: new Set(),
    anchorRowId: rows[0]?.id ?? null,
    undo: [],
    redo: [],
    notice: null,
    staleRowIds: []
});

export const rowIndexOf = (state: GridState, id: string | null): number =>
    id === null ? -1 : state.rows.findIndex((row) => row.id === id);

export const focusedRow = (state: GridState): MediaItem | undefined =>
    state.rows.find((row) => row.id === state.focusRowId);

/**
 * The vertical run of cells the cursor spans: anchor to focus, in the focused column.
 *
 * This is the spreadsheet selection, and it is deliberately *not* the same thing as
 * `selected` — that set is the rename queue, which Space toggles and which the confirm
 * dialog reads. Shift+arrow happens to grow both, because filling a run of cells and
 * renaming that run of files are the same intent; but a paste writes into this, never
 * into a tick the user made somewhere else in the grid.
 *
 * One row wide when nothing has been extended, so every caller can treat "the focused
 * cell" as a range of one and there is no second code path for the common case.
 */
export const rangeRowIds = (state: GridState): string[] => {
    const focus = rowIndexOf(state, state.focusRowId);
    if (focus < 0) return [];
    const anchor = rowIndexOf(state, state.anchorRowId);
    const from = anchor < 0 ? focus : Math.min(anchor, focus);
    const to = anchor < 0 ? focus : Math.max(anchor, focus);
    return state.rows.slice(from, to + 1).map((row) => row.id);
};

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

const column = (index: number): ColumnSpec | undefined => COLUMNS[index];

const groupById = (patches: Patch[]): Map<string, Patch[]> => {
    const byId = new Map<string, Patch[]>();
    for (const patch of patches) byId.set(patch.id, [...(byId.get(patch.id) ?? []), patch]);
    return byId;
};

/**
 * The rows a transaction invalidated, deduplicated.
 *
 * Same rule as `patchRow`: touching an input makes the row's proposal stale, touching
 * `proposed_name` does not. Undo and redo go through here too — reverting a title to
 * what it was is as much a reason to re-match as changing it was.
 */
const staleFrom = (patches: Patch[]): string[] => [
    ...new Set(patches.filter((patch) => patch.field !== 'proposed_name').map((patch) => patch.id))
];

/**
 * The ticks that survive a change to the rows.
 *
 * `isRowValid` gates all three ways a row is *ticked* — Space, Ctrl+A, Shift+Arrow —
 * but nothing re-checked it afterwards, so a tick outlived the validity that earned it.
 * Delete a ticked row's proposal, or type a bad season into it, and the tick stayed on
 * a row the grid was painting red; `App.tsx` then posted it to `/api/rename` with the
 * rest of the batch. The tick is what the user reads as "this file is going to be
 * written" and it is the only thing the confirmation counts, so the last gate has to
 * hold after every write, not just at the moment of ticking.
 *
 * The same set comes back when nothing was dropped, so an ordinary edit does not hand
 * the grid a new selection object to re-render against.
 */
const survivingSelection = (selected: ReadonlySet<string>, rows: MediaItem[]): ReadonlySet<string> => {
    if (selected.size === 0) return selected;
    const surviving = new Set(rows.filter((row) => selected.has(row.id) && isRowValid(row)).map((row) => row.id));
    return surviving.size === selected.size ? selected : surviving;
};

/** Applies a transaction and records it, so undo restores every cell it touched at once. */
const applyPatches = (state: GridState, patches: Patch[], notice: string | null = null): GridState => {
    if (patches.length === 0) return state;
    const byId = groupById(patches);
    const rows = state.rows.map((row) => {
        const rowPatches = byId.get(row.id);
        return rowPatches ? patchRow(row, rowPatches) : row;
    });

    return {
        ...state,
        rows,
        selected: survivingSelection(state.selected, rows),
        undo: [...state.undo, patches],
        redo: [],
        notice,
        staleRowIds: staleFrom(patches)
    };
};

/**
 * Editing an *input* field invalidates the proposal that was derived from it, so the
 * row drops back to `pending` and loses its candidates — a name that no longer follows
 * from the title above it must not keep a confident dot next to it.
 *
 * Editing `proposed_name` is the opposite case: the user is writing the name by hand,
 * which is a decision, not a staleness. The status is left exactly as it was.
 */
const patchRow = (row: MediaItem, patches: Patch[]): MediaItem => {
    const next: MediaItem = { ...row };
    let inputChanged = false;
    for (const patch of patches) {
        (next as unknown as Record<string, unknown>)[patch.field] = patch.after;
        if (patch.field !== 'proposed_name') inputChanged = true;
    }
    if (inputChanged) {
        next.status = 'pending';
        next.confidence = undefined;
        next.message = undefined;
        next.candidates = [];
    }
    return next;
};

const invert = (patches: Patch[]): Patch[] =>
    patches.map((patch) => ({ ...patch, before: patch.after, after: patch.before }));

const patchFor = (row: MediaItem, columnIndex: number, text: string): Patch | null => {
    const spec = column(columnIndex);
    if (!spec?.editable) return null;
    const field = spec.id as EditableField;
    const before = row[field];
    const after = parseCell(field, text);
    if (before === after) return null;
    return { id: row.id, field, before, after };
};

/**
 * Writes one string into the focused column of every cell in the range.
 *
 * Paste and Delete are the same operation with a different string, and both have to
 * land as one transaction: forty cells emptied by accident must come back on one
 * Ctrl+Z, not forty.
 */
const writeRange = (state: GridState, text: string): GridState => {
    const spec = column(state.focusColumn);
    if (!spec?.editable) return state;
    const ids = new Set(rangeRowIds(state));
    const patches = state.rows
        .filter((row) => ids.has(row.id))
        .map((row) => patchFor(row, state.focusColumn, text))
        .filter((patch): patch is Patch => patch !== null);
    const notice = patches.length > 1 ? `${spec.header || spec.id}: ${patches.length} celle aggiornate` : null;
    return applyPatches(state, patches, notice);
};

const moveFocus = (state: GridState, rowDelta: number, columnDelta: number, extend = false): GridState => {
    if (state.rows.length === 0) return state;
    const current = clamp(rowIndexOf(state, state.focusRowId), 0, state.rows.length - 1);
    const nextRow = clamp(current + rowDelta, 0, state.rows.length - 1);
    const nextColumn = clamp(state.focusColumn + columnDelta, 0, COLUMNS.length - 1);
    const focusRowId = state.rows[nextRow].id;

    if (!extend) {
        return { ...state, focusRowId, focusColumn: nextColumn, anchorRowId: focusRowId, editing: null };
    }

    // Shift+arrow extends from the anchor, and only over rows that could actually be
    // renamed — selecting a row the backend would refuse is a promise the UI cannot keep.
    const anchor = clamp(rowIndexOf(state, state.anchorRowId ?? focusRowId), 0, state.rows.length - 1);
    const [from, to] = anchor <= nextRow ? [anchor, nextRow] : [nextRow, anchor];
    const selected = new Set(state.selected);
    for (let index = from; index <= to; index += 1) {
        if (isRowValid(state.rows[index])) selected.add(state.rows[index].id);
    }
    return { ...state, focusRowId, focusColumn: nextColumn, selected, editing: null };
};

export const gridReducer = (state: GridState, action: GridAction): GridState => {
    switch (action.type) {
        case 'setRows': {
            const rows = sortRows(action.rows);
            const ids = new Set(rows.map((row) => row.id));
            const focusRowId = state.focusRowId && ids.has(state.focusRowId) ? state.focusRowId : (rows[0]?.id ?? null);
            return {
                ...state,
                rows,
                focusRowId,
                anchorRowId: focusRowId,
                editing: null,
                // Selection and history are about rows that existed a moment ago. Carrying
                // either across a rescan would let a stale tick rename a file nobody looked at.
                selected: new Set(),
                undo: [],
                redo: [],
                staleRowIds: []
            };
        }

        case 'mergeRows': {
            const updates = new Map(action.rows.map((row) => [row.id, row]));
            const rows = state.rows.map((row) => updates.get(row.id) ?? row);
            // An answer coming back invalidates a tick as surely as an edit does: a
            // re-analysis that finds nothing clears the proposal the tick was for.
            return { ...state, rows, selected: survivingSelection(state.selected, rows) };
        }

        /**
         * Put the rows back in the order `sortRows` defines.
         *
         * Deliberately not done inside `mergeRows`. Analysis lands six answers at a
         * time and each one can rewrite the title the order is built from, so sorting
         * there would shuffle rows under the cursor while they are being worked in.
         * The shell asks for this once a batch has finished, which is also the only
         * moment the order is actually stale.
         */
        case 'sort':
            return { ...state, rows: sortRows(state.rows) };

        case 'focusCell':
            return {
                ...state,
                focusRowId: action.rowId,
                focusColumn: clamp(action.column, 0, COLUMNS.length - 1),
                anchorRowId: action.rowId,
                editing: null
            };

        case 'move':
            return moveFocus(state, action.rows, action.columns, action.extend);

        case 'moveEdge': {
            if (state.rows.length === 0) return state;
            if (action.edge === 'top') return moveFocus(state, -state.rows.length, 0);
            if (action.edge === 'bottom') return moveFocus(state, state.rows.length, 0);
            if (action.edge === 'first') return moveFocus(state, 0, -COLUMNS.length);
            return moveFocus(state, 0, COLUMNS.length);
        }

        case 'beginEdit': {
            const row = focusedRow(state);
            if (!row || !column(state.focusColumn)?.editable) return state;
            const field = COLUMNS[state.focusColumn].id as EditableField;
            const existing = row[field];
            // Typing a character replaces the cell, as in a spreadsheet; F2 and Enter
            // open it with what is already there.
            const draft = action.initial !== undefined ? action.initial : existing === undefined || existing === null ? '' : String(existing);
            return { ...state, editing: { rowId: row.id, column: state.focusColumn, draft } };
        }

        case 'changeDraft':
            return state.editing ? { ...state, editing: { ...state.editing, draft: action.draft } } : state;

        case 'commitEdit': {
            if (!state.editing) return state;
            const { rowId, column: editedColumn, draft } = state.editing;
            const row = state.rows.find((candidate) => candidate.id === rowId);
            const patch = row ? patchFor(row, editedColumn, draft) : null;
            const committed = patch ? applyPatches({ ...state, editing: null }, [patch]) : { ...state, editing: null };
            if (action.then === 'down') return moveFocus(committed, 1, 0);
            if (action.then === 'right') return moveFocus(committed, 0, 1);
            return committed;
        }

        case 'cancelEdit':
            return { ...state, editing: null };

        case 'setCell': {
            const row = state.rows.find((candidate) => candidate.id === action.rowId);
            const patch = row ? patchFor(row, action.column, action.text) : null;
            return patch ? applyPatches(state, [patch]) : state;
        }

        case 'toggleSelection': {
            const row = focusedRow(state);
            if (!row) return state;
            // The refusal says which of the three it is: a cell to correct, a row nothing
            // was found for, or a file already named that way. Only the first has a
            // highlighted cell to point at, so one generic notice would misdirect the
            // other two.
            const refusal = rowRefusal(row);
            if (refusal) return { ...state, notice: refusal };
            const selected = new Set(state.selected);
            if (selected.has(row.id)) selected.delete(row.id);
            else selected.add(row.id);
            return { ...state, selected, anchorRowId: row.id };
        }

        case 'selectAll': {
            const valid = state.rows.filter(isRowValid);
            const everySelected = valid.length > 0 && valid.every((row) => state.selected.has(row.id));
            const selected = everySelected ? new Set<string>() : new Set(valid.map((row) => row.id));
            const skipped = state.rows.length - valid.length;
            return {
                ...state,
                selected,
                notice:
                    everySelected || skipped === 0
                        ? null
                        : `${skipped} ${skipped === 1 ? 'riga saltata' : 'righe saltate'} — non rinominabili`
            };
        }

        case 'clearSelection':
            return { ...state, selected: new Set() };

        case 'setSelection': {
            // Through the same gate as every other way of ticking. The two callers tick
            // by status, and a status is not a promise that the row can be written: an
            // auto-ticked `matched` row whose proposal was blanked by hand would come
            // straight back.
            const wanted = new Set(action.ids);
            return { ...state, selected: survivingSelection(wanted, state.rows) };
        }

        case 'fillDown': {
            const source = focusedRow(state);
            const spec = column(state.focusColumn);
            if (!source || !spec?.editable) return state;
            // A vertical cell selection is the target when there is one, which is the
            // spreadsheet reflex. Otherwise the ticked rows, which is what lets a
            // non-contiguous set — picked one Space at a time — be filled in one go.
            const range = rangeRowIds(state);
            const wanted: ReadonlySet<string> = range.length > 1 ? new Set(range) : state.selected;
            const targets = state.rows.filter((row) => row.id !== source.id && wanted.has(row.id));
            if (targets.length === 0) {
                return { ...state, notice: 'Seleziona prima le righe da riempire (spazio, o shift+frecce)' };
            }
            const text = String(source[spec.id as EditableField] ?? '');
            const patches = targets.map((row) => patchFor(row, state.focusColumn, text)).filter((patch): patch is Patch => patch !== null);
            return applyPatches(state, patches, `${spec.header || spec.id} ricopiato in ${patches.length} righe`);
        }

        /**
         * The next value of a cell that has a fixed set of them — today only Type.
         *
         * A choice cell is never typed into. It used to open a `<select>` seeded with
         * whatever character started the edit, which matched no option, so the control
         * looked inert and could commit a value that was neither movie nor episode.
         * Two values means one key: Enter, and again to change your mind.
         *
         * `column` names one explicitly, so the same action serves the chord that flips
         * Type from anywhere on the row. Wrong type is the single most common thing to
         * have to correct, and walking to its column first is three keystrokes of tax.
         */
        case 'cycleChoice': {
            const target = action.column ?? state.focusColumn;
            const row = focusedRow(state);
            const spec = column(target);
            if (!row || !spec?.editable || !spec.choices?.length) return state;
            const at = spec.choices.indexOf(String(row[spec.id as EditableField] ?? ''));
            // -1 for "unknown", which is not one of the choices: the first one is next.
            const patch = patchFor(row, target, spec.choices[(at + 1) % spec.choices.length]);
            return patch ? applyPatches(state, [patch]) : state;
        }

        /** Both write the focused column across the whole vertical selection. */
        case 'clearCell':
            return writeRange(state, '');

        case 'pasteCell':
            return writeRange(state, action.text);

        /**
         * Find and replace across the proposed names — the whole table, or the ticked
         * rows.
         *
         * The same correction on forty names is the case this exists for, so like every
         * other bulk write here it lands as **one** transaction: forty names rewritten
         * by a typo in the search box come back on one Ctrl+Z.
         *
         * It goes through `patchFor` like a typed edit, which is what keeps it out of
         * `staleRowIds`: rewriting a proposal is a decision, not a stale input, so the
         * rows do not re-analyse themselves and hand back the name that was just
         * corrected.
         */
        case 'replaceInNames': {
            const edits = replacementsFor(state.rows, state.selected, action.request);
            if (edits.length === 0) {
                return { ...state, notice: `Nessun nome proposto contiene «${action.request.find}»` };
            }
            const after = new Map(edits.map((edit) => [edit.id, edit.after]));
            const target = columnIndex('proposed_name');
            const patches = state.rows
                .filter((row) => after.has(row.id))
                .map((row) => patchFor(row, target, after.get(row.id)!))
                .filter((patch): patch is Patch => patch !== null);
            return applyPatches(
                state,
                patches,
                `${patches.length} ${patches.length === 1 ? 'nome sostituito' : 'nomi sostituiti'}`
            );
        }

        case 'undo': {
            const last = state.undo[state.undo.length - 1];
            if (!last) return { ...state, notice: 'Niente da annullare' };
            const reverted = invert(last);
            const byId = groupById(reverted);
            return {
                ...state,
                rows: state.rows.map((row) => (byId.has(row.id) ? patchRow(row, byId.get(row.id)!) : row)),
                undo: state.undo.slice(0, -1),
                redo: [...state.redo, last],
                notice: null,
                staleRowIds: staleFrom(reverted)
            };
        }

        case 'redo': {
            const next = state.redo[state.redo.length - 1];
            if (!next) return { ...state, notice: 'Niente da ripristinare' };
            const byId = groupById(next);
            return {
                ...state,
                rows: state.rows.map((row) => (byId.has(row.id) ? patchRow(row, byId.get(row.id)!) : row)),
                undo: [...state.undo, next],
                redo: state.redo.slice(0, -1),
                notice: null,
                staleRowIds: staleFrom(next)
            };
        }

        case 'dismissNotice':
            return state.notice === null ? state : { ...state, notice: null };

        case 'clearStale':
            return state.staleRowIds.length === 0 ? state : { ...state, staleRowIds: [] };

        default:
            return state;
    }
};
