// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CandidateOut, MediaItem } from '../api';
import { TriageOverlay } from './TriageOverlay';

/**
 * Triage, and specifically the search by hand.
 *
 * The one thing here that can silently rename a file wrongly is the override: a
 * candidate found by searching "Breaking Bad" is resolved by the backend inside the
 * results for the *row's* title, so if the typed title does not travel with the pick,
 * `forced_key` is absent from those results and the choice is thrown away. That is a
 * refusal rather than a wrong name, but the opposite mistake — sending the override on
 * a candidate the scoring itself proposed — rewrites a title nobody asked to change.
 */

const candidate = (overrides: Partial<CandidateOut> = {}): CandidateOut => ({
    key: '81797',
    label: 'One Piece',
    source: 'tvdb',
    year: 1999,
    score: 0.5,
    title_score: 1,
    year_factor: 1,
    selected: false,
    ...overrides
});

const row = (overrides: Partial<MediaItem> = {}): MediaItem => ({
    id: '1',
    original_path: '/media/BrBa S01E02.mkv',
    original_name: 'BrBa S01E02.mkv',
    media_type: 'episode',
    clean_title: 'BrBa',
    year: null,
    season: 1,
    episode: 2,
    proposed_name: null,
    status: 'error',
    confidence: null,
    message: 'Nessuna corrispondenza trovata',
    candidates: [],
    ...overrides
});

let container: HTMLDivElement;
let root: Root;

const render = (props: Partial<React.ComponentProps<typeof TriageOverlay>> = {}) => {
    const item = props.queue?.[0] ?? row();
    return act(() => {
        root.render(
            <TriageOverlay
                rows={[item]}
                queue={[item]}
                startId={item.id}
                onPick={() => undefined}
                onSearch={() => Promise.resolve([])}
                onSkip={() => undefined}
                onClose={() => undefined}
                {...props}
            />
        );
    });
};

const find = <T extends Element>(selector: string): T => container.querySelector<T>(selector) as T;

const button = (label: string) =>
    [...container.querySelectorAll('button')].find((element) => element.textContent === label) as HTMLButtonElement;

/** React reads the value off the node's own descriptor, so it has to be set there. */
const type = (input: HTMLInputElement, value: string) =>
    act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });

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

describe('TriageOverlay', () => {
    it('offers a search on a row nothing was found for, instead of a dead end', async () => {
        await act(async () => {
            render();
        });
        expect(find<HTMLInputElement>('.triage-search input')).toBeTruthy();
        // The type is the filter — the row is an episode, so the search cannot return
        // films — and saying so is what stops that from being a mystery.
        expect(find('.triage-search-scope').textContent).toContain('TVDB');
        expect(container.querySelector('.candidate-none')?.textContent).toContain('cercalo qui sopra');
    });

    it('searches on the typed title and year, and lists what comes back', async () => {
        const onSearch = vi.fn().mockResolvedValue([candidate({ label: 'Breaking Bad', key: '81189' })]);
        await act(async () => {
            render({ onSearch });
        });

        await type(find<HTMLInputElement>('.triage-search input'), 'Breaking Bad');
        await type(find<HTMLInputElement>('.triage-search .narrow'), '2008');
        await act(async () => {
            button('Cerca').click();
        });

        expect(onSearch).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }), 'Breaking Bad', 2008);
        expect(container.querySelector('.candidate-label')?.textContent).toContain('Breaking Bad');
        expect(find('.triage-search-result').textContent).toContain('1 risultato');
    });

    it('sends the typed title along with a pick made from the search', async () => {
        const onPick = vi.fn();
        const onSearch = vi.fn().mockResolvedValue([candidate({ label: 'Breaking Bad', key: '81189' })]);
        await act(async () => {
            render({ onPick, onSearch });
        });

        await type(find<HTMLInputElement>('.triage-search input'), 'Breaking Bad');
        await act(async () => {
            button('Cerca').click();
        });
        await act(async () => {
            find<HTMLButtonElement>('.candidate').click();
        });

        expect(onPick.mock.calls[0][1].key).toBe('81189');
        // Without this the backend searches "BrBa" again, does not find 81189 among the
        // results, and refuses the pick rather than renaming to something nobody chose.
        expect(onPick.mock.calls[0][2]).toEqual({ override: { clean_title: 'Breaking Bad', year: null } });
    });

    it('leaves the row alone when the pick came from the scoring itself', async () => {
        const onPick = vi.fn();
        const item = row({ status: 'review', clean_title: 'Doctor Who', candidates: [candidate()] });
        await act(async () => {
            render({ onPick, rows: [item], queue: [item] });
        });

        await act(async () => {
            find<HTMLButtonElement>('.candidate').click();
        });
        expect(onPick.mock.calls[0][2]).toBeUndefined();
    });

    it('lets a digit be typed into the year instead of picking a candidate', async () => {
        const onPick = vi.fn();
        const item = row({ status: 'review', candidates: [candidate()] });
        await act(async () => {
            render({ onPick, rows: [item], queue: [item] });
        });

        const yearBox = find<HTMLInputElement>('.triage-search .narrow');
        await act(async () => {
            yearBox.focus();
            yearBox.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
        });
        expect(onPick).not.toHaveBeenCalled();
    });

    it('sends the absolute number with the pick, for the series to resolve', async () => {
        const onPick = vi.fn();
        const item = row({ id: '9', status: 'matched', clean_title: 'One Piece', candidates: [candidate()] });
        await act(async () => {
            render({ onPick, rows: [item], queue: [item] });
        });

        await type(find<HTMLInputElement>('#absolute-episode'), '1015');
        await act(async () => {
            find<HTMLButtonElement>('.candidate').click();
        });

        // Not a season and an episode: only the chosen series knows that 1015 is S21E124,
        // so the number travels as the question and comes back as the answer.
        expect(onPick.mock.calls[0][2]).toEqual({ absolute: 1015 });
    });

    it('settles one file when an absolute number is given, never the whole series', async () => {
        const onPick = vi.fn();
        const one = row({ id: '1', original_name: 'One Piece - 1015.mkv', clean_title: 'One Piece', episode: 1015 });
        const two = row({ id: '2', original_name: 'One Piece - 1016.mkv', clean_title: 'One Piece', episode: 1016 });
        const withCandidates = { ...one, status: 'review' as const, candidates: [candidate()] };
        await act(async () => {
            render({ onPick, rows: [withCandidates, two], queue: [withCandidates] });
        });

        // The checkbox is on by default, and this is the one thing that must override it:
        // replaying 1015 across the season would file every episode as the same one.
        expect(find<HTMLInputElement>('.apply-series input').checked).toBe(true);
        await type(find<HTMLInputElement>('#absolute-episode'), '1015');
        expect(find<HTMLInputElement>('.apply-series input').disabled).toBe(true);

        await act(async () => {
            find<HTMLButtonElement>('.candidate').click();
        });
        expect(onPick.mock.calls[0][0].map((affected: MediaItem) => affected.id)).toEqual(['1']);
    });

    it('does not offer an absolute number on a film', async () => {
        const item = row({ media_type: 'movie', clean_title: 'Matrix', status: 'review', candidates: [candidate()] });
        await act(async () => {
            render({ rows: [item], queue: [item] });
        });
        expect(container.querySelector('#absolute-episode')).toBeNull();
    });

    it('walks the candidates with the arrows and picks the one under the cursor', async () => {
        const onPick = vi.fn();
        const item = row({
            status: 'review',
            candidates: [candidate({ key: 'a' }), candidate({ key: 'b' }), candidate({ key: 'c' })]
        });
        await act(async () => {
            render({ onPick, rows: [item], queue: [item] });
        });

        // On the panel, not in a field: with the focus in the search box these are a
        // caret, and the overlay stands down. That is the same rule the grid follows.
        const press = (key: string) =>
            act(() => {
                document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
            });

        await press('ArrowDown');
        await press('ArrowDown');
        expect(find('.candidate.is-cursor').textContent).toContain('3');
        await press('ArrowUp');
        await press('Enter');
        expect(onPick.mock.calls[0][1].key).toBe('b');
    });
});
