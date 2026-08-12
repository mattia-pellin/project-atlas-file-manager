import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { MediaItem } from '../api';
import { cellText, COLUMNS, ColumnId } from '../lib/columns';
import { GridAction, GridState, rowIndexOf } from '../lib/gridReducer';
import { isTypingKey, matchesChord } from '../lib/keymap';
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
}

/** Which single cell is to blame, so the row's red edge points somewhere. */
const cellIsInvalid = (item: MediaItem, column: ColumnId): boolean => {
    if (column === 'year') return !isYearValid(item.year);
    if (column === 'season') return item.media_type === 'episode' && !isSeasonValid(item.season);
    if (column === 'episode') return item.media_type === 'episode' && !isEpisodeValid(item.episode);
    if (column === 'media_type') return item.media_type !== 'movie' && item.media_type !== 'episode';
    return false;
};

const ROW_HEIGHT = 30;
const PAGE = 20;

const helper = createColumnHelper<MediaItem>();

export const Grid: React.FC<GridProps> = ({ state, dispatch, onOpenTriage, onCopy, onPaste }) => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const editRef = useRef<HTMLInputElement | HTMLSelectElement>(null);

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

    // Keyboard navigation is worthless if the cell you moved to is off screen.
    useEffect(() => {
        if (focusIndex >= 0) virtualizer.scrollToIndex(focusIndex, { align: 'auto' });
    }, [focusIndex, virtualizer]);

    useEffect(() => {
        if (state.editing) editRef.current?.focus();
    }, [state.editing]);

    const template = useMemo(
        () =>
            COLUMNS.map((spec) =>
                spec.grow ? `minmax(${spec.width}px, ${spec.id === 'proposed_name' ? 1.6 : 1}fr)` : `${spec.width}px`
            ).join(' '),
        []
    );

    const onKeyDown = useCallback(
        (event: React.KeyboardEvent) => {
            const spec = COLUMNS[state.focusColumn];

            // --- While editing, the input owns nearly everything ------------------
            if (state.editing) {
                if (matchesChord(event, 'enter')) {
                    event.preventDefault();
                    dispatch({ type: 'commitEdit', then: 'down' });
                } else if (matchesChord(event, 'escape')) {
                    event.preventDefault();
                    dispatch({ type: 'cancelEdit' });
                } else if (matchesChord(event, 'tab') || matchesChord(event, 'shift+tab')) {
                    event.preventDefault();
                    dispatch({ type: 'commitEdit', then: event.shiftKey ? 'stay' : 'right' });
                }
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
            if (matchesChord(event, 'enter')) {
                event.preventDefault();
                // Enter on the status dot opens triage: the dot is the thing that says
                // the row is unresolved, so it is the thing you press.
                if (spec?.id === 'status') {
                    if (state.focusRowId) onOpenTriage(state.focusRowId);
                } else {
                    dispatch({ type: 'beginEdit' });
                }
                return;
            }
            if (matchesChord(event, 'f2')) {
                event.preventDefault();
                dispatch({ type: 'beginEdit' });
                return;
            }
            if (matchesChord(event, 'delete') || matchesChord(event, 'backspace')) {
                event.preventDefault();
                dispatch({ type: 'clearCell' });
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
        <div className="grid" role="grid" aria-rowcount={rows.length} tabIndex={0} onKeyDown={onKeyDown}>
            <div className="grid-head" style={{ gridTemplateColumns: template }} role="row">
                {COLUMNS.map((spec) => (
                    <div key={spec.id} role="columnheader" className={`grid-head-cell align-${spec.align ?? 'left'}`}>
                        {spec.header}
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
                                                isFocused ? 'is-focused' : '',
                                                cellIsInvalid(item, spec.id) ? 'is-cell-invalid' : ''
                                            ]
                                                .filter(Boolean)
                                                .join(' ')}
                                            onMouseDown={() =>
                                                dispatch({ type: 'focusCell', rowId: item.id, column: columnIdx })
                                            }
                                            onDoubleClick={() => spec.editable && dispatch({ type: 'beginEdit' })}
                                        >
                                            {edit ? (
                                                <CellEditor
                                                    ref={editRef}
                                                    kind={spec.choices ? 'choice' : 'text'}
                                                    choices={spec.choices}
                                                    value={edit.draft}
                                                    onChange={(draft) => dispatch({ type: 'changeDraft', draft })}
                                                    onBlur={() => dispatch({ type: 'commitEdit', then: 'stay' })}
                                                />
                                            ) : (
                                                <span className="grid-value">
                                                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                                </span>
                                            )}
                                            {spec.id === 'proposed_name' && !edit && item.confidence !== undefined && (
                                                <span className="confidence mono">{item.confidence.toFixed(2)}</span>
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
};

interface EditorProps {
    kind: 'text' | 'choice';
    choices?: readonly string[];
    value: string;
    onChange: (value: string) => void;
    onBlur: () => void;
}

const CellEditor = React.forwardRef<HTMLInputElement | HTMLSelectElement, EditorProps>(
    ({ kind, choices, value, onChange, onBlur }, ref) => {
        if (kind === 'choice' && choices) {
            return (
                <select
                    ref={ref as React.Ref<HTMLSelectElement>}
                    className="cell-editor"
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    onBlur={onBlur}
                >
                    {choices.map((choice) => (
                        <option key={choice} value={choice}>
                            {choice}
                        </option>
                    ))}
                </select>
            );
        }
        return (
            <input
                ref={ref as React.Ref<HTMLInputElement>}
                className="cell-editor"
                value={value}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => onChange(event.target.value)}
                onBlur={onBlur}
            />
        );
    }
);
CellEditor.displayName = 'CellEditor';
