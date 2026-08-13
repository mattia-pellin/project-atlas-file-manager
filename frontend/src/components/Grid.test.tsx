// @vitest-environment jsdom
import { act, useReducer } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MediaItem } from '../api';
import { columnIndex } from '../lib/columns';
import { gridReducer, initialGridState } from '../lib/gridReducer';
import { Grid } from './Grid';

/**
 * The grid, rendered into a real DOM.
 *
 * `renderToString` cannot stand in for this: the virtualizer has no scroll element on
 * the server, so it emits zero rows and every row-level render bug passes. The bug
 * this file exists for did exactly that — the shell smoke test was green while the
 * first scan blanked the screen.
 */

const scanned = (overrides: Partial<MediaItem> = {}): MediaItem => ({
    // Every unfilled field is an explicit null, which is what pydantic sends and what
    // `/api/scan` therefore puts on the wire before anything has been analyzed.
    id: '1',
    original_path: '/media/Doctor Who S05E02.mkv',
    original_name: 'Doctor Who S05E02.mkv',
    media_type: 'episode',
    clean_title: 'Doctor Who',
    year: null,
    season: 5,
    episode: 2,
    episode_title: null,
    proposed_name: null,
    tmdb_id: null,
    tvdb_id: null,
    status: 'pending',
    confidence: null,
    message: null,
    candidates: [],
    ...overrides
});

let container: HTMLDivElement;
let root: Root;

const VIEWPORT = { width: 1200, height: 800 };

declare global {
     
    var IS_REACT_ACT_ENVIRONMENT: boolean;
}

beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    // jsdom lays nothing out: every element is 0×0 and there is no ResizeObserver, so
    // the virtualizer concludes that nothing is on screen and renders no rows at all.
    // Giving it a viewport is what makes this a test of the rows rather than of the
    // header. The numbers are arbitrary; only "big enough to hold a row" matters.
    globalThis.ResizeObserver ??= class {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
    for (const [property, value] of [
        ['offsetHeight', VIEWPORT.height],
        ['clientHeight', VIEWPORT.height],
        ['offsetWidth', VIEWPORT.width],
        ['clientWidth', VIEWPORT.width]
    ] as const) {
        Object.defineProperty(HTMLElement.prototype, property, { configurable: true, get: () => value });
    }
    HTMLElement.prototype.getBoundingClientRect = () => ({
        ...VIEWPORT,
        top: 0,
        left: 0,
        right: VIEWPORT.width,
        bottom: VIEWPORT.height,
        x: 0,
        y: 0,
        toJSON: () => undefined
    });
});

const render = (rows: MediaItem[]): string => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root.render(
            <Grid
                state={initialGridState(rows)}
                dispatch={() => undefined}
                onOpenTriage={() => undefined}
                onCopy={() => undefined}
                onPaste={() => undefined}
                onExplainConfidence={() => undefined}
            />
        );
    });
    return container.innerHTML;
};

/**
 * The same grid, but wired to the real reducer.
 *
 * `render` above passes a frozen state and a dispatch that discards, which is right for
 * asking what one state paints. It cannot ask what a *keystroke* leaves behind: the
 * editor never unmounts, so the focus bug below is invisible through it.
 */
const Live: React.FC<{ rows: MediaItem[] }> = ({ rows }) => {
    const [state, dispatch] = useReducer(gridReducer, rows, initialGridState);
    return (
        <>
            {/* Stands in for Scansiona: something outside the grid that can take the focus
                while a cell is being edited. */}
            <button type="button" id="elsewhere">
                Scansiona
            </button>
            <Grid
                state={state}
                dispatch={dispatch}
                onOpenTriage={() => undefined}
                onCopy={() => undefined}
                onPaste={() => undefined}
                onExplainConfidence={() => undefined}
            />
        </>
    );
};

const renderLive = (rows: MediaItem[]): HTMLElement => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<Live rows={rows} />));
    const grid = container.querySelector<HTMLElement>('.grid');
    if (!grid) throw new Error('no grid');
    grid.focus();
    return grid;
};

const press = (key: string) => {
    act(() => {
        document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    });
};

/** Types into a controlled input the way the browser does — React listens for `input`. */
const type = (input: HTMLInputElement, text: string) => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    act(() => {
        setValue?.call(input, text);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
};

/** Onto `Titolo`, the first editable column — the cursor starts on a read-only one. */
const focusFirstEditableColumn = () => {
    for (let step = 1; step < columnIndex('clean_title'); step += 1) press('ArrowRight');
};

const editor = () => container.querySelector('input');

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

describe('Grid', () => {
    it('draws a freshly scanned row, nulls and all', () => {
        // The regression: `confidence: null` reached `.toFixed(2)` during the render,
        // React unmounted the whole tree, and pressing Scan turned the screen black.
        const html = render([scanned()]);

        expect(html).toContain('Doctor Who S05E02.mkv');
        expect(html).toContain('Doctor Who');
        expect(html).toContain('role="row"');
    });

    it('prints no confidence until there is one, and a percentage once there is', () => {
        expect(render([scanned()])).not.toMatch(/\d+%/);
        expect(render([scanned({ confidence: 0.5, proposed_name: 'Doctor Who - S05E02.mkv' })])).toContain('50%');
    });

    it('gives the score its own column, with a way to ask what it means', () => {
        const html = render([scanned()]);
        expect(html).toContain('C.S.');
        expect(html).toContain('Che cos\'è il confidence score');
    });

    it('offers the reorder in the status header, and only with rows to reorder', () => {
        // Sorting is on demand now: analysis rewrites the very fields the order is built
        // from, so an automatic re-sort moved the row out from under whoever was editing it.
        expect(render([scanned()])).toContain('Riordina la tabella');
        expect(render([])).toContain('disabled=""');
    });

    it('draws every status as a dot with its own accessible name, never as the word', () => {
        const statuses: MediaItem['status'][] = [
            'pending',
            'analyzing',
            'matched',
            'review',
            'renaming',
            'error',
            'success'
        ];
        const html = render(statuses.map((status, index) => scanned({ id: String(index), status })));

        expect(html.match(/class="status-dot"/g)).toHaveLength(statuses.length);
        // One distinct name per state: a dot that reads the same as another dot is no
        // better than no dot, and the name is all a screen reader gets. Scoped to the
        // dots themselves — the header carries an aria-label of its own.
        const names = new Set(Array.from(html.matchAll(/role="img" aria-label="([^"]+)"/g), (match) => match[1]));
        expect(names.size).toBe(statuses.length);
    });
});

/**
 * Leaving an edit has to leave the keyboard where it found it.
 *
 * The editor unmounts with the DOM focus inside it, which drops focus to `body`, and
 * App hands it back only on a mode change or a new set of rows — neither of which an
 * edit is. So every key after the first `Enter` went nowhere and the grid could only be
 * revived with the mouse, in the one tool whose whole point is not needing it.
 */
describe('Grid, leaving an edit', () => {
    it('gives the keyboard back to the grid on Enter', () => {
        const grid = renderLive([scanned()]);
        focusFirstEditableColumn();
        press('F2');
        expect(document.activeElement).toBe(editor());

        press('Enter');

        expect(editor()).toBeNull();
        expect(document.activeElement).toBe(grid);
    });

    it('gives it back on Escape too, without committing what was cancelled', () => {
        // The restore blurs the input while it is still mounted, so its `onBlur` fires a
        // second `commitEdit`. That must stay a no-op — turning a cancel into a commit
        // would write a discarded value to a row about to be renamed.
        const grid = renderLive([scanned()]);
        focusFirstEditableColumn();
        press('F2');
        type(editor()!, 'Rubbish');

        press('Escape');

        expect(document.activeElement).toBe(grid);
        expect(container.textContent).toContain('Doctor Who');
        expect(container.textContent).not.toContain('Rubbish');
    });

    it('gives it back on Tab, which is the other key that ends an edit', () => {
        const grid = renderLive([scanned()]);
        focusFirstEditableColumn();
        press('F2');

        press('Tab');

        expect(editor()).toBeNull();
        expect(document.activeElement).toBe(grid);
    });

    it('does not take the focus off whatever was clicked instead', () => {
        // The other way out of an edit is the input's own blur. Restoring focus on *that*
        // path would snatch it back from the button the user just pressed, so the fix
        // deliberately lives in the key handler and not in an effect on `state.editing`.
        renderLive([scanned()]);
        focusFirstEditableColumn();
        press('F2');

        const elsewhere = container.querySelector<HTMLButtonElement>('#elsewhere')!;
        act(() => elsewhere.focus());

        expect(document.activeElement).toBe(elsewhere);
    });
});
