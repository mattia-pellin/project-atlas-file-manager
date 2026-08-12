import { MediaItem } from '../api';

/**
 * The grid's column model, shared by the renderer and by the keyboard reducer.
 *
 * One definition, because the two must agree on which columns exist, in what
 * order and which of them accept typing — a reducer that thinks column 3 is the
 * year while the header says season is a silent data-corruption bug.
 */

export type EditableField = 'media_type' | 'clean_title' | 'year' | 'season' | 'episode' | 'proposed_name';
export type ColumnId = 'status' | 'original_name' | EditableField;

export interface ColumnSpec {
    id: ColumnId;
    header: string;
    /** Fixed width in px. Growing columns use it as their minimum. */
    width: number;
    grow?: boolean;
    editable: boolean;
    mono?: boolean;
    align?: 'left' | 'right' | 'center';
    choices?: readonly string[];
}

export const COLUMNS: readonly ColumnSpec[] = [
    { id: 'status', header: '', width: 34, editable: false, align: 'center' },
    { id: 'original_name', header: 'On disk', width: 260, grow: true, editable: false },
    // Wide enough for both segments of the toggle to be legible side by side. A choice
    // cell is not typed into, so the width is the control's, not the longest value's.
    { id: 'media_type', header: 'Type', width: 124, editable: true, choices: ['movie', 'episode'] },
    { id: 'clean_title', header: 'Title', width: 210, editable: true },
    { id: 'year', header: 'Year', width: 58, editable: true, mono: true, align: 'right' },
    { id: 'season', header: 'S', width: 46, editable: true, mono: true, align: 'right' },
    { id: 'episode', header: 'E', width: 62, editable: true, mono: true, align: 'right' },
    { id: 'proposed_name', header: 'Proposed name', width: 320, grow: true, editable: true }
];

export const columnIndex = (id: ColumnId): number => COLUMNS.findIndex((column) => column.id === id);

export const isEditableColumn = (column: number): boolean => Boolean(COLUMNS[column]?.editable);

/** The value a cell shows, as text. Editing starts from exactly this string. */
export const cellText = (item: MediaItem, column: ColumnId): string => {
    if (column === 'status') return item.status;
    const value = item[column as keyof MediaItem];
    return value === undefined || value === null ? '' : String(value);
};

/**
 * The confidence, as the two decimals the grid prints — or nothing.
 *
 * A pure function rather than an expression in the cell, because the null it has to
 * survive is exactly what crashed the grid: an unanalyzed row carries
 * `confidence: null`, and `null.toFixed(2)` throws mid-render.
 */
export const confidenceText = (item: MediaItem): string | null =>
    typeof item.confidence === 'number' ? item.confidence.toFixed(2) : null;

/**
 * Turns typed text back into a field value.
 *
 * Numbers stay numbers so the backend does not have to guess, but a *non-numeric*
 * year is kept as typed rather than silently becoming NaN or 0 — validation is what
 * tells the user it is wrong, and a value that disappears as you type it cannot be
 * corrected.
 */
export const parseCell = (column: EditableField, text: string): unknown => {
    const trimmed = text.trim();
    if (trimmed === '') return undefined;

    if (column === 'year' || column === 'season') {
        return /^\d+$/.test(trimmed) ? Number(trimmed) : trimmed;
    }
    if (column === 'episode') {
        // "10-12" is a legitimate value, so episodes stay strings unless plainly numeric.
        return /^\d+$/.test(trimmed) ? Number(trimmed) : trimmed;
    }
    if (column === 'media_type') return trimmed.toLowerCase();
    return trimmed;
};
