// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MediaItem } from '../api';
import { initialGridState } from '../lib/gridReducer';
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
            />
        );
    });
    return container.innerHTML;
};

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

    it('prints no confidence until there is one, and two decimals once there is', () => {
        expect(render([scanned()])).not.toContain('class="confidence');
        expect(render([scanned({ confidence: 0.5, proposed_name: 'Doctor Who - S05E02.mkv' })])).toContain('0.50');
    });

    it('draws every status as a dot with its own accessible name, never as the word', () => {
        const statuses: MediaItem['status'][] = ['pending', 'matched', 'review', 'renaming', 'error', 'success'];
        const html = render(statuses.map((status, index) => scanned({ id: String(index), status })));

        expect(html.match(/class="status-dot"/g)).toHaveLength(statuses.length);
        // Six states, six distinct names: a dot that reads the same as another dot is
        // no better than no dot, and the name is all a screen reader gets.
        const names = new Set(Array.from(html.matchAll(/aria-label="([^"]+)"/g), (match) => match[1]));
        expect(names.size).toBe(statuses.length);
    });
});
