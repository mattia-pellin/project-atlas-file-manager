// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaItem } from '../api';
import { ConfirmRename } from './ConfirmRename';

/**
 * The last gate before the filesystem.
 *
 * Two things are pinned here. The tally, because it is the whole screen — a batch that
 * says "1 film" when twenty-four episodes were ticked is a selection mistake caught at
 * a glance. And the confirming chord, because it writes to a real Plex library: it must
 * be the modified one, and it must not fire on the bare key.
 *
 * The names themselves are the grid's job, and this panel deliberately does not repeat
 * them — the test below says so, so a "helpful" list cannot come back unnoticed.
 */

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

let container: HTMLDivElement;
let root: Root;

const render = (props: Partial<React.ComponentProps<typeof ConfirmRename>> = {}) =>
    act(() => {
        root.render(
            <ConfirmRename items={[item()]} onConfirm={() => undefined} onCancel={() => undefined} {...props} />
        );
    });

/** Count and label read separately: the space between them is a flex gap, not text. */
const tallies = () =>
    [...container.querySelectorAll('.confirm-tally')].map(
        (tile) =>
            `${tile.querySelector('.confirm-tally-count')?.textContent} ${tile.querySelector('.confirm-tally-label')?.textContent}`
    );

beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

describe('ConfirmRename', () => {
    it('is the tally and nothing else — the names stay in the grid', () => {
        render();
        expect(container.textContent).not.toContain('Show.S01E01.mkv');
        expect(container.textContent).not.toContain('Show - S01E01 - Pilot.mkv');
        expect(container.querySelector('.confirm-summary')).toBeTruthy();
    });

    it('counts the batch in the heading, so the total is still stated', () => {
        render({ items: [item(), item({ id: '2' })] });
        expect(container.querySelector('.panel-head h2')?.textContent).toBe('Rinomina 2 file');
    });

    it('says the rename cannot be undone, however confident the batch is', () => {
        render();
        expect(container.querySelector('.confirm-warning')?.textContent).toContain('Non si torna indietro');
    });

    it('warns when a file that was never confidently matched is in the batch', () => {
        render({ items: [item(), item({ id: '2', status: 'review' })] });
        expect(container.querySelector('.confirm-risk')?.textContent).toContain('con sicurezza');
    });

    it('says nothing about confidence when every file was matched', () => {
        render();
        expect(container.querySelector('.confirm-risk')).toBeNull();
    });

    it('counts films and episodes separately, and says which is which', () => {
        render({
            items: [
                item(),
                item({ id: '2' }),
                item({ id: '3', media_type: 'movie', proposed_name: 'Matrix Reloaded (2003).mkv' })
            ]
        });
        expect(tallies()).toEqual(['1 film', '2 episodi']);
    });

    it('leaves out the kinds the batch does not contain', () => {
        // "0 film" is the one number nobody needs to read on a batch of episodes.
        render();
        expect(tallies()).toEqual(['1 episodio']);
    });

    it('confirms on the chord that opened it, and not on the bare key', () => {
        const onConfirm = vi.fn();
        render({ onConfirm });

        act(() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        expect(onConfirm).not.toHaveBeenCalled();

        act(() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
        });
        expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('leaves on Escape without renaming anything', () => {
        const onCancel = vi.fn();
        const onConfirm = vi.fn();
        render({ onCancel, onConfirm });

        act(() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onConfirm).not.toHaveBeenCalled();
    });
});
