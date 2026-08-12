import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import App from './App';
import { ConfirmRename } from './components/ConfirmRename';
import { MediaItem } from './api';

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

        expect(html).toContain('atlas');
        expect(html).toContain('Nothing scanned yet');
    });
});

describe('ConfirmRename', () => {
    const item = (overrides: Partial<MediaItem> = {}): MediaItem => ({
        id: '1',
        original_path: '/media/Show.S01E01.mkv',
        original_name: 'Show.S01E01.mkv',
        media_type: 'episode',
        clean_title: 'Show',
        season: 1,
        episode: 1,
        proposed_name: 'Show - S01E01 - Pilot.mkv',
        status: 'matched',
        confidence: 0.9,
        ...overrides
    });

    it('shows both names in full, for every file', () => {
        // Nothing is summarised: the exact string is the only thing that can be checked
        // before the filesystem is touched.
        const html = renderToString(<ConfirmRename items={[item()]} onConfirm={() => undefined} onCancel={() => undefined} />);
        expect(html).toContain('Show.S01E01.mkv');
        expect(html).toContain('Show - S01E01 - Pilot.mkv');
        expect(html).toContain('confirm-list');
    });

    it('warns when a file that was never confidently matched is in the batch', () => {
        const html = renderToString(
            <ConfirmRename items={[item(), item({ id: '2', status: 'review' })]} onConfirm={() => undefined} onCancel={() => undefined} />
        );
        expect(html).toContain('never confidently matched');
    });
});
