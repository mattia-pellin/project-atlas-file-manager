import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import App from './App';

/**
 * A smoke test, deliberately shallow.
 *
 * The behaviour worth pinning lives in the reducer and the helpers, which are tested
 * without a DOM. This is here for the other failure mode — a component that throws on
 * first render — which typechecking does not catch and which would ship as a blank page.
 */

describe('App', () => {
    it('renders the shell before anything has been scanned', () => {
        vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
        const html = renderToString(<App />);

        expect(html).toContain('Project:');
        expect(html).toContain('Atlas');
        expect(html).toContain('Files');
        expect(html).toContain('Avvia la scansione');
    });

    it('shows the counts and the keys for the current mode in the status bar', () => {
        vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
        const html = renderToString(<App />);

        expect(html).toContain('status-counts');
        expect(html).toContain('0 file');
        expect(html).toContain('ricopia');
    });
});

// The rows themselves are covered in components/Grid.test.tsx, which needs a real DOM:
// `renderToString` gives the virtualizer no scroll element, so it emits no rows at all
// and a row-level crash renders as a pass. The confirmation is in
// components/ConfirmRename.test.tsx for the same reason — its chord lives in an effect,
// which server rendering never runs.
