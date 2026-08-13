import { MediaItem } from '../api';
import { percent } from './format';

/**
 * The grid's column model, shared by the renderer and by the keyboard reducer.
 *
 * One definition, because the two must agree on which columns exist, in what
 * order and which of them accept typing — a reducer that thinks column 3 is the
 * year while the header says season is a silent data-corruption bug.
 */

export type EditableField = 'media_type' | 'clean_title' | 'year' | 'season' | 'episode' | 'proposed_name';
export type ColumnId = 'status' | 'original_name' | 'confidence' | EditableField;

export interface ColumnSpec {
    id: ColumnId;
    header: string;
    /** Fixed width in px. Growing columns use it as their minimum, and it is what a
     *  double-click on the resize handle restores. */
    width: number;
    grow?: boolean;
    editable: boolean;
    mono?: boolean;
    align?: 'left' | 'right' | 'center';
    /**
     * Where the *header* sits, when that is not where the values sit. A number column
     * reads best right-aligned and a one-letter heading over it reads best centred, so
     * the two are separate settings rather than one.
     */
    headerAlign?: 'left' | 'right' | 'center';
    choices?: readonly string[];
    /**
     * What each choice is *called* on screen. The stored value is not translated —
     * `media_type` goes to the backend and decides which provider is asked — so the
     * label is a separate map rather than a different set of choices.
     */
    choiceLabels?: Readonly<Record<string, string>>;
}

export const COLUMNS: readonly ColumnSpec[] = [
    // Wide enough to hold the reorder button in the header as well as the dot below it.
    { id: 'status', header: '', width: 40, editable: false, align: 'center' },
    { id: 'original_name', header: 'Su disco', width: 260, grow: true, editable: false },
    // Wide enough for both segments of the toggle to be legible side by side. A choice
    // cell is not typed into, so the width is the control's, not the longest value's.
    {
        id: 'media_type',
        header: 'Tipo',
        width: 124,
        editable: true,
        align: 'center',
        headerAlign: 'center',
        choices: ['movie', 'episode'],
        choiceLabels: { movie: 'film', episode: 'episodio' }
    },
    { id: 'clean_title', header: 'Titolo', width: 210, editable: true },
    // Centred on both halves. A year is always four digits, so there are no ragged
    // edges to line up and nothing is gained by pinning it right — while a heading
    // sitting over a column that does not share its alignment reads as a mistake.
    { id: 'year', header: 'Anno', width: 62, editable: true, mono: true, align: 'center', headerAlign: 'center' },
    // `S` alone over a right-aligned column reads better hard against the numbers than
    // floating in the middle of a 50px box, so this one takes the cells' alignment.
    { id: 'season', header: 'S', width: 50, editable: true, mono: true, align: 'right' },
    { id: 'episode', header: 'E', width: 66, editable: true, mono: true, align: 'right', headerAlign: 'center' },
    { id: 'proposed_name', header: 'Nome proposto', width: 320, grow: true, editable: true },
    // The score used to be a badge floated inside the proposed name, where it competed
    // with the name for the same pixels and disappeared as soon as the name was long.
    // Its own column also gives it somewhere to hang the explanation of what it means.
    // Heading right-aligned like the percentages under it, the same reasoning as `S`.
    { id: 'confidence', header: 'C.S.', width: 74, editable: false, mono: true, align: 'right' }
];

export const columnIndex = (id: ColumnId): number => COLUMNS.findIndex((column) => column.id === id);

export const isEditableColumn = (column: number): boolean => Boolean(COLUMNS[column]?.editable);

/** How a choice is written on screen. Falls back to the value, which is never wrong. */
export const choiceLabel = (spec: ColumnSpec, value: string): string => spec.choiceLabels?.[value] ?? value;

/**
 * The choice a typed letter means — matched against the label first, then the value.
 *
 * `f` has to reach `movie` now that the cell reads *film*, and `m` has to keep working
 * for anyone who learnt it the other way round.
 */
export const choiceFromKey = (spec: ColumnSpec, key: string): string | undefined => {
    const letter = key.toLowerCase();
    return (
        spec.choices?.find((choice) => choiceLabel(spec, choice).toLowerCase().startsWith(letter)) ??
        spec.choices?.find((choice) => choice.startsWith(letter))
    );
};

/** The value a cell shows, as text. Editing starts from exactly this string. */
export const cellText = (item: MediaItem, column: ColumnId): string => {
    if (column === 'status') return item.status;
    // Never the raw 0.5: the score is written as a percentage everywhere, and this is
    // also what Ctrl+C copies out of the cell.
    if (column === 'confidence') return confidenceText(item) ?? '';
    const value = item[column as keyof MediaItem];
    return value === undefined || value === null ? '' : String(value);
};

/**
 * The confidence, as the percentage the grid prints — or nothing.
 *
 * A pure function rather than an expression in the cell, because the null it has to
 * survive is exactly what crashed the grid: an unanalyzed row carries
 * `confidence: null`, and `null.toFixed(2)` throws mid-render.
 */
export const confidenceText = (item: MediaItem): string | null =>
    typeof item.confidence === 'number' ? percent(item.confidence) : null;

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
