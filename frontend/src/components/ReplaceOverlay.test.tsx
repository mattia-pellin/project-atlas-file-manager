// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaItem } from '../api';
import { ReplaceOverlay } from './ReplaceOverlay';

/**
 * The panel writes forty names at once, so what is pinned here is the promise it makes
 * before it does: the preview is the transaction. The count on screen, the specimens
 * under it and the request handed to the reducer all come from one pure function, and a
 * panel that offered to replace something it would not replace would be the worst kind
 * of wrong in this app — plausible, and only visible after the files have moved.
 */

const item = (id: string, proposed: string | undefined): MediaItem =>
    ({
        id,
        original_path: `/media/${id}.mkv`,
        original_name: `${id}.mkv`,
        media_type: 'episode',
        clean_title: 'Doctor Who',
        season: 5,
        episode: 1,
        proposed_name: proposed,
        status: 'matched',
        confidence: 0.9
    }) as MediaItem;

const ROWS = [
    item('a', 'Doctor Who - S05E01 - The Tomb.mkv'),
    item('b', 'Doctor Who - S05E02 - The Wheel.mkv'),
    item('c', 'Breaking Bad - S01E01 - Pilot.mkv')
];

let container: HTMLDivElement;
let root: Root;

const render = (props: Partial<React.ComponentProps<typeof ReplaceOverlay>> = {}) =>
    act(() => {
        root.render(
            <ReplaceOverlay
                rows={ROWS}
                selected={new Set(['b'])}
                onApply={() => undefined}
                onClose={() => undefined}
                {...props}
            />
        );
    });

const field = (id: string) => container.querySelector<HTMLInputElement>(`#${id}`)!;

/** React listens on its own value setter, so a raw `.value =` is not seen as typing. */
const type = (input: HTMLInputElement, text: string) =>
    act(() => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
        setter.call(input, text);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });

const click = (element: Element) => act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));

const previews = () => [...container.querySelectorAll('.replace-list li')].map((li) => li.textContent);

const scopeButtons = () => [...container.querySelectorAll<HTMLButtonElement>('.replace-scope .choice-option')];

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

describe('ReplaceOverlay', () => {
    it('opens on the ticked rows when there are any — that is how a batch is chosen here', () => {
        render();
        expect(scopeButtons()[1].getAttribute('aria-checked')).toBe('true');
    });

    it('opens on the whole table when nothing is ticked, and cannot narrow to nothing', () => {
        render({ selected: new Set() });
        expect(scopeButtons()[0].getAttribute('aria-checked')).toBe('true');
        expect(scopeButtons()[1].disabled).toBe(true);
    });

    it('previews the exact names it is about to write', () => {
        render({ selected: new Set() });
        type(field('replace-find'), 'Doctor Who');
        type(field('replace-with'), 'Doctor Who (2005)');

        expect(container.querySelector('.replace-count')?.textContent).toBe('2 nomi da riscrivere.');
        expect(previews()[0]).toContain('Doctor Who (2005) - S05E01 - The Tomb.mkv');
    });

    it('counts only the ticked rows in the narrow scope', () => {
        render();
        type(field('replace-find'), 'Doctor Who');
        expect(container.querySelector('.replace-count')?.textContent).toBe('1 nome da riscrivere.');
    });

    it('hands the reducer the request the preview was built from', () => {
        const onApply = vi.fn();
        render({ onApply, selected: new Set() });
        type(field('replace-find'), 'The');
        type(field('replace-with'), 'Il');

        click(container.querySelector('.button.primary')!);
        expect(onApply).toHaveBeenCalledWith({ find: 'The', replace: 'Il', matchCase: true, scope: 'all' });
    });

    it('distinguishes case by default, since half of what is corrected here is the case', () => {
        render({ selected: new Set() });
        type(field('replace-find'), 'doctor who');
        expect(container.querySelector('.replace-count')?.textContent).toContain('Nessun nome');

        click(container.querySelector('.check input')!);
        expect(container.querySelector('.replace-count')?.textContent).toBe('2 nomi da riscrivere.');
    });

    it('refuses to run on nothing', () => {
        const onApply = vi.fn();
        render({ onApply });
        const apply = container.querySelector<HTMLButtonElement>('.button.primary')!;
        expect(apply.disabled).toBe(true);

        // Enter is the same command as the button, so it has to be just as dead.
        act(() => field('replace-find').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
        expect(onApply).not.toHaveBeenCalled();
    });

    it('leaves on Escape without replacing anything', () => {
        const onApply = vi.fn();
        const onClose = vi.fn();
        render({ onApply, onClose });
        act(() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onApply).not.toHaveBeenCalled();
    });

    it('says which column it writes, because it is the only one it may write', () => {
        render();
        expect(container.textContent).toContain('Nome proposto');
    });
});
