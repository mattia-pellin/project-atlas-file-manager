import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { MediaItem } from '../api';
import { cellText, choiceFromKey, choiceLabel, COLUMNS, ColumnId, ColumnSpec, columnIndex } from '../lib/columns';
import { GridAction, GridState, rangeRowIds, rowIndexOf } from '../lib/gridReducer';
import { isTypingKey, matchesChord } from '../lib/keymap';
import { TYPE_CHORD } from '../lib/shortcuts';
import { isEpisodeValid, isRowValid, isSeasonValid, isYearValid } from '../lib/validation';
import { StatusDot } from './StatusDot';

/**
 * The grid.
 *
 * Rendering only: every key it receives becomes a reducer action, and the reducer
 * is where the behaviour is decided and tested. TanStack supplies the row model and
 * the virtualizer; the row order is whatever `state.rows` says, so sorting is a
 * command that reorders the data rather than a view-only shuffle the keyboard model
 * would then disagree with.
 */

interface GridProps {
    state: GridState;
    dispatch: React.Dispatch<GridAction>;
    onOpenTriage: (rowId: string) => void;
    onCopy: (text: string) => void;
    onPaste: () => void;
    /** Opens the explanation of the C.S. column. The shell owns the overlays. */
    onExplainConfidence: () => void;
}

/** Which single cell is to blame, so the row's red edge points somewhere. */
const cellIsInvalid = (item: MediaItem, column: ColumnId): boolean => {
    if (column === 'year') return !isYearValid(item.year);
    if (column === 'season') return item.media_type === 'episode' && !isSeasonValid(item.season);
    if (column === 'episode') return item.media_type === 'episode' && !isEpisodeValid(item.episode);
    if (column === 'media_type') return item.media_type !== 'movie' && item.media_type !== 'episode';
    return false;
};

/** Kept in step with `--row-height` in styles/tokens.css. */
const ROW_HEIGHT = 36;
const PAGE = 20;

/** Narrow enough to park a column out of the way, wide enough to still find its handle. */
const MIN_COLUMN_WIDTH = 44;

const TYPE_COLUMN = columnIndex('media_type');

const helper = createColumnHelper<MediaItem>();

const InfoGlyph: React.FC = () => (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
        <circle cx="6" cy="6" r="4.6" />
        <path d="M6 5.3v3" strokeLinecap="round" />
        <path d="M6 3.5v.1" strokeLinecap="round" strokeWidth="1.6" />
    </svg>
);

/** Bars of decreasing length under a down arrow: the sort icon everything else uses. */
const SortGlyph: React.FC = () => (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
        <path d="M1.6 3h6M1.6 6.5h4M1.6 10h2" strokeLinecap="round" />
        <path d="M10 2.6v7.8M8.2 8.6 10 10.4l1.8-1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

export const Grid = React.forwardRef<HTMLDivElement, GridProps>(function Grid(
    { state, dispatch, onOpenTriage, onCopy, onPaste, onExplainConfidence },
    ref
) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const editRef = useRef<HTMLInputElement>(null);
    /**
     * Widths the user has dragged to. Only the dragged ones are here: everything else
     * keeps the column model's own width, so a resize is a local override rather than a
     * second, competing source of truth for the layout.
     */
    const [widths, setWidths] = useState<Partial<Record<ColumnId, number>>>({});

    const columns = useMemo(
        () =>
            COLUMNS.map((spec) =>
                helper.display({
                    id: spec.id,
                    header: spec.header,
                    cell: ({ row }) =>
                        spec.id === 'status' ? <StatusDot item={row.original} /> : cellText(row.original, spec.id)
                })
            ),
        []
    );

    const table = useReactTable({
        data: state.rows,
        columns,
        getRowId: (row) => row.id,
        getCoreRowModel: getCoreRowModel()
    });
    const rows = table.getRowModel().rows;

    const virtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => ROW_HEIGHT,
        overscan: 12
    });

    const focusIndex = rowIndexOf(state, state.focusRowId);

    /**
     * The cells a paste or a delete would write, painted before it happens.
     *
     * Empty unless the run spans more than one row and the column can actually take a
     * value: a single focused cell is already shown by its own ring, and highlighting a
     * run down a read-only column would promise a write that `writeRange` refuses.
     */
    const rangeIds = useMemo(() => {
        if (!COLUMNS[state.focusColumn]?.editable) return new Set<string>();
        const ids = rangeRowIds(state);
        return ids.length > 1 ? new Set(ids) : new Set<string>();
    }, [state]);

    // Keyboard navigation is worthless if the cell you moved to is off screen.
    useEffect(() => {
        if (focusIndex >= 0) virtualizer.scrollToIndex(focusIndex, { align: 'auto' });
    }, [focusIndex, virtualizer]);

    useEffect(() => {
        if (state.editing) editRef.current?.focus();
    }, [state.editing]);

    // A dragged column stops growing: the user asked for that many pixels, so giving it
    // more when the window is wide would make the handle feel like it did nothing.
    const template = useMemo(
        () =>
            COLUMNS.map((spec) => {
                const dragged = widths[spec.id];
                if (dragged !== undefined) return `${dragged}px`;
                return spec.grow
                    ? `minmax(${spec.width}px, ${spec.id === 'proposed_name' ? 1.6 : 1}fr)`
                    : `${spec.width}px`;
            }).join(' '),
        [widths]
    );

    /**
     * Dragging measures the column as rendered rather than trusting the model: a growing
     * column is whatever the window left it, and starting the drag from its declared
     * minimum would make it jump before it moved.
     */
    const startResize = useCallback((spec: ColumnSpec, event: React.PointerEvent<HTMLSpanElement>) => {
        const head = event.currentTarget.parentElement;
        if (!head) return;
        event.preventDefault();
        event.stopPropagation();
        const startX = event.clientX;
        const startWidth = head.getBoundingClientRect().width;

        const onMove = (move: PointerEvent) => {
            const next = Math.max(MIN_COLUMN_WIDTH, Math.round(startWidth + move.clientX - startX));
            setWidths((current) => ({ ...current, [spec.id]: next }));
        };
        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            document.body.classList.remove('is-resizing-column');
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        // The cursor has to survive leaving the 6px handle, or a fast drag looks broken.
        document.body.classList.add('is-resizing-column');
    }, []);

    const resetWidth = useCallback((spec: ColumnSpec) => {
        setWidths(({ [spec.id]: _dropped, ...rest }) => rest);
    }, []);

    const onKeyDown = useCallback(
        // Typed to the div it is attached to, so `currentTarget` is the grid element
        // itself — that is what restores the focus below without threading a ref through
        // the forwarded one App already owns.
        (event: React.KeyboardEvent<HTMLDivElement>) => {
            const spec = COLUMNS[state.focusColumn];

            // --- While editing, the input owns nearly everything ------------------
            if (state.editing) {
                let ended = true;
                if (matchesChord(event, 'enter')) {
                    event.preventDefault();
                    dispatch({ type: 'commitEdit', then: 'down' });
                } else if (matchesChord(event, 'escape')) {
                    event.preventDefault();
                    dispatch({ type: 'cancelEdit' });
                } else if (matchesChord(event, 'tab') || matchesChord(event, 'shift+tab')) {
                    event.preventDefault();
                    dispatch({ type: 'commitEdit', then: event.shiftKey ? 'stay' : 'right' });
                } else {
                    ended = false;
                }
                // The editor is about to unmount with the DOM focus inside it, which sends
                // focus to `body` and leaves the grid deaf: App's effect hands it back only
                // on a mode change or a new set of rows, so neither happens here and the
                // whole keyboard model is unreachable until a cell is clicked. Ending one
                // edit should not cost the fluency the grid exists for.
                //
                // Restored here rather than in an effect on `state.editing`, because the
                // other way out of an edit is the input's own `onBlur` — the user clicking
                // Scansiona, or opening an overlay — and yanking focus back off the thing
                // they just clicked is a worse bug than the one being fixed. Only a key
                // that ends the edit returns it.
                //
                // Safe to do while the input is still mounted: this blurs it, so `onBlur`
                // dispatches a second `commitEdit`, and the reducer's `if (!state.editing)`
                // guard makes it a no-op — including after `cancelEdit`, which must not be
                // quietly turned back into a commit.
                if (ended) event.currentTarget.focus();
                return;
            }

            // --- Movement ---------------------------------------------------------
            const moves: Array<[string, number, number]> = [
                ['arrowup', -1, 0],
                ['arrowdown', 1, 0],
                ['arrowleft', 0, -1],
                ['arrowright', 0, 1],
                ['pageup', -PAGE, 0],
                ['pagedown', PAGE, 0]
            ];
            for (const [chord, rowDelta, columnDelta] of moves) {
                if (matchesChord(event, chord) || matchesChord(event, `shift+${chord}`)) {
                    event.preventDefault();
                    dispatch({ type: 'move', rows: rowDelta, columns: columnDelta, extend: event.shiftKey });
                    return;
                }
            }
            if (matchesChord(event, 'tab') || matchesChord(event, 'shift+tab')) {
                event.preventDefault();
                dispatch({ type: 'move', rows: 0, columns: event.shiftKey ? -1 : 1 });
                return;
            }
            if (matchesChord(event, 'mod+home') || matchesChord(event, 'mod+end')) {
                event.preventDefault();
                dispatch({ type: 'moveEdge', edge: matchesChord(event, 'mod+home') ? 'top' : 'bottom' });
                return;
            }
            if (matchesChord(event, 'home') || matchesChord(event, 'end')) {
                event.preventDefault();
                dispatch({ type: 'moveEdge', edge: matchesChord(event, 'home') ? 'first' : 'last' });
                return;
            }

            // --- Selection ---------------------------------------------------------
            if (matchesChord(event, 'space')) {
                event.preventDefault();
                dispatch({ type: 'toggleSelection' });
                return;
            }
            if (matchesChord(event, 'mod+a')) {
                event.preventDefault();
                dispatch({ type: 'selectAll' });
                return;
            }

            // --- Editing ------------------------------------------------------------
            if (matchesChord(event, 'enter') || matchesChord(event, 'f2')) {
                event.preventDefault();
                // Enter on the status dot opens triage: the dot is the thing that says
                // the row is unresolved, so it is the thing you press.
                if (spec?.id === 'status') {
                    if (matchesChord(event, 'enter') && state.focusRowId) onOpenTriage(state.focusRowId);
                } else if (spec?.choices) {
                    dispatch({ type: 'cycleChoice' });
                } else {
                    dispatch({ type: 'beginEdit' });
                }
                return;
            }
            if (matchesChord(event, 'delete') || matchesChord(event, 'backspace')) {
                event.preventDefault();
                dispatch({ type: 'clearCell' });
                return;
            }
            // Flip the type from wherever the cursor is. Naming a movie as an episode
            // asks the wrong API entirely, so it is the correction most often needed and
            // the one least worth walking to a column for.
            if (matchesChord(event, TYPE_CHORD)) {
                event.preventDefault();
                dispatch({ type: 'cycleChoice', column: TYPE_COLUMN });
                return;
            }
            if (matchesChord(event, 'mod+d')) {
                event.preventDefault();
                dispatch({ type: 'fillDown' });
                return;
            }
            if (matchesChord(event, 'mod+z')) {
                event.preventDefault();
                dispatch({ type: 'undo' });
                return;
            }
            if (matchesChord(event, 'mod+shift+z') || matchesChord(event, 'mod+y')) {
                event.preventDefault();
                dispatch({ type: 'redo' });
                return;
            }
            if (matchesChord(event, 'mod+c')) {
                const row = state.rows[focusIndex];
                if (row && spec) onCopy(cellText(row, spec.id));
                return;
            }
            if (matchesChord(event, 'mod+v')) {
                event.preventDefault();
                onPaste();
                return;
            }

            // Type-to-edit, last so it can never shadow a chord.
            if (isTypingKey(event) && spec?.editable) {
                event.preventDefault();
                // On a choice cell the initial letter *is* the answer — "f" is film —
                // rather than the first character of a value being typed.
                if (spec.choices) {
                    const wanted = choiceFromKey(spec, event.key);
                    if (wanted && state.focusRowId) {
                        dispatch({ type: 'setCell', rowId: state.focusRowId, column: state.focusColumn, text: wanted });
                    }
                    return;
                }
                dispatch({ type: 'beginEdit', initial: event.key });
            }
        },
        [
            dispatch,
            focusIndex,
            onCopy,
            onOpenTriage,
            onPaste,
            state.editing,
            state.focusColumn,
            state.focusRowId,
            state.rows
        ]
    );

    return (
        <div className="grid" role="grid" aria-rowcount={rows.length} tabIndex={0} ref={ref} onKeyDown={onKeyDown}>
            <div className="grid-head" style={{ gridTemplateColumns: template }} role="row">
                {COLUMNS.map((spec) => (
                    <div
                        key={spec.id}
                        role="columnheader"
                        className={`grid-head-cell align-${spec.headerAlign ?? spec.align ?? 'left'}`}
                    >
                        <span className="grid-head-label">{spec.header}</span>
                        {/*
                         * Reordering is a command, not something an edit does on its own. An
                         * edit marks the row stale and re-matches it, and sorting on that
                         * answer moved the row out from under the cursor that had just typed
                         * into it. The order is still the same total order — this is the
                         * button that asks for it.
                         */}
                        {spec.id === 'status' && (
                            <button
                                type="button"
                                className="head-sort"
                                tabIndex={-1}
                                aria-label="Riordina la tabella"
                                title="Riordina la tabella — film, titolo, anno, stagione, episodio"
                                disabled={state.rows.length === 0}
                                onClick={() => dispatch({ type: 'sort' })}
                            >
                                <SortGlyph />
                            </button>
                        )}
                        {spec.id === 'confidence' && (
                            <button
                                type="button"
                                className="head-info"
                                tabIndex={-1}
                                aria-label="Che cos'è il confidence score"
                                title="Che cos'è il confidence score"
                                onClick={onExplainConfidence}
                            >
                                <InfoGlyph />
                            </button>
                        )}
                        {/* The status column holds the dot and the sort button; nothing to widen. */}
                        {spec.id !== 'status' && (
                            <span
                                className="col-resizer"
                                aria-hidden="true"
                                title="Trascina per ridimensionare — doppio clic per ripristinare"
                                onPointerDown={(event) => startResize(spec, event)}
                                onDoubleClick={() => resetWidth(spec)}
                            />
                        )}
                    </div>
                ))}
            </div>

            <div className="grid-body" ref={scrollRef}>
                <div className="grid-canvas" style={{ height: virtualizer.getTotalSize() }}>
                    {virtualizer.getVirtualItems().map((virtualRow) => {
                        const row = rows[virtualRow.index];
                        const item = row.original;
                        const isSelected = state.selected.has(item.id);
                        const isFocusRow = item.id === state.focusRowId;
                        const classes = [
                            'grid-row',
                            isSelected ? 'is-selected' : '',
                            isFocusRow ? 'is-focus-row' : '',
                            isRowValid(item) ? '' : 'is-invalid'
                        ];

                        return (
                            <div
                                key={item.id}
                                role="row"
                                aria-selected={isSelected}
                                aria-rowindex={virtualRow.index + 1}
                                className={classes.filter(Boolean).join(' ')}
                                style={{
                                    gridTemplateColumns: template,
                                    height: virtualRow.size,
                                    transform: `translateY(${virtualRow.start}px)`
                                }}
                            >
                                {row.getVisibleCells().map((cell, columnIdx) => {
                                    const spec = COLUMNS[columnIdx];
                                    const text = spec.id === 'status' ? '' : cellText(item, spec.id);
                                    const isFocused = isFocusRow && state.focusColumn === columnIdx;
                                    const edit =
                                        state.editing &&
                                        state.editing.rowId === item.id &&
                                        state.editing.column === columnIdx
                                            ? state.editing
                                            : null;

                                    return (
                                        <div
                                            key={cell.id}
                                            role="gridcell"
                                            className={[
                                                'grid-cell',
                                                `align-${spec.align ?? 'left'}`,
                                                spec.mono ? 'mono' : '',
                                                spec.id === 'confidence' ? 'is-confidence' : '',
                                                isFocused ? 'is-focused' : '',
                                                columnIdx === state.focusColumn && rangeIds.has(item.id)
                                                    ? 'is-in-range'
                                                    : '',
                                                cellIsInvalid(item, spec.id) ? 'is-cell-invalid' : ''
                                            ]
                                                .filter(Boolean)
                                                .join(' ')}
                                            onMouseDown={() =>
                                                dispatch({ type: 'focusCell', rowId: item.id, column: columnIdx })
                                            }
                                            onDoubleClick={() =>
                                                spec.editable && !spec.choices && dispatch({ type: 'beginEdit' })
                                            }
                                        >
                                            {edit ? (
                                                <CellEditor
                                                    ref={editRef}
                                                    value={edit.draft}
                                                    onChange={(draft) => dispatch({ type: 'changeDraft', draft })}
                                                    onBlur={() => dispatch({ type: 'commitEdit', then: 'stay' })}
                                                />
                                            ) : spec.choices ? (
                                                <ChoiceCell
                                                    spec={spec}
                                                    value={cellText(item, spec.id)}
                                                    choices={spec.choices}
                                                    onPick={(text) =>
                                                        dispatch({ type: 'setCell', rowId: item.id, column: columnIdx, text })
                                                    }
                                                />
                                            ) : (
                                                // The value is clipped with an ellipsis when the column is
                                                // narrower than it, so the whole of it lives in the tooltip —
                                                // a truncated Plex name is exactly the thing you need to read.
                                                <span className="grid-value" title={text || undefined}>
                                                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                                </span>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
});

/**
 * A cell with a fixed set of values, shown as the values themselves.
 *
 * It replaces a `<select>` that opened on type-to-edit seeded with the character
 * typed — which matched no option, so the control looked stuck and could be committed
 * as neither movie nor episode. Both answers being visible at once means the cell can
 * be read without being opened, and changed in one click or one key.
 */
const ChoiceCell: React.FC<{
    spec: ColumnSpec;
    value: string;
    choices: readonly string[];
    onPick: (value: string) => void;
}> = ({ spec, value, choices, onPick }) => (
    <span className="choice">
        {choices.map((choice) => (
            <button
                key={choice}
                type="button"
                className={`choice-option${choice === value ? ' is-on' : ''}`}
                aria-pressed={choice === value}
                tabIndex={-1}
                onClick={() => onPick(choice)}
            >
                {/* The label is translated; the value sent back never is. */}
                {choiceLabel(spec, choice)}
            </button>
        ))}
    </span>
);

interface EditorProps {
    value: string;
    onChange: (value: string) => void;
    onBlur: () => void;
}

const CellEditor = React.forwardRef<HTMLInputElement, EditorProps>(({ value, onChange, onBlur }, ref) => (
    <input
        ref={ref}
        className="cell-editor"
        value={value}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
    />
));
CellEditor.displayName = 'CellEditor';
