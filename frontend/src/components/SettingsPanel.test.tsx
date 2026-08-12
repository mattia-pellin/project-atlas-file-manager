// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api';
import { DEFAULT_SETTINGS } from '../lib/settings';
import { SettingsPanel } from './SettingsPanel';

/**
 * The panel in a real DOM, because the two things worth checking are both about what
 * it *refuses*: Apply must be dead while a language code is bad, and the keys must be
 * checked by asking rather than by reading `tmdb_configured`.
 */

let container: HTMLDivElement;
let root: Root;

const render = (props: Partial<React.ComponentProps<typeof SettingsPanel>> = {}) =>
    act(() => {
        root.render(
            <SettingsPanel
                settings={{ ...DEFAULT_SETTINGS, languages: 'it,en' }}
                config={null}
                onApply={() => undefined}
                onClearCache={() => undefined}
                onClose={() => undefined}
                {...props}
            />
        );
    });

const applyButton = () =>
    [...container.querySelectorAll('button')].find((button) => button.textContent === 'Apply') as HTMLButtonElement;

const chip = (code: string) =>
    [...container.querySelectorAll('.lang-chip')].find((element) => element.textContent?.startsWith(code));

beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(api, 'checkKeys').mockResolvedValue({
        tmdb: { state: 'ok', detail: 'TMDB accepted this key' },
        tvdb: { state: 'invalid', detail: 'TVDB rejected this key or its PIN' }
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
});

describe('SettingsPanel', () => {
    it('checks the keys by using them, and shows each as one icon', async () => {
        await act(async () => {
            render();
        });
        expect(api.checkKeys).toHaveBeenCalledTimes(1);

        const icons = container.querySelectorAll('.key-icon');
        expect(icons).toHaveLength(2);
        expect(icons[0].className).toContain('is-ok');
        // The sentence is the accessible name; the key itself is never rendered.
        expect(icons[1].getAttribute('aria-label')).toBe('TVDB rejected this key or its PIN');
        expect(container.querySelector('.key-list')?.textContent).not.toContain('rejected');
    });

    it('refuses to apply a language code nothing speaks', async () => {
        await act(async () => {
            render({ settings: { ...DEFAULT_SETTINGS, languages: 'it,xx' } });
        });
        expect(applyButton().disabled).toBe(true);
        expect(container.querySelector('.field-error')?.textContent).toBe('xx is not a language code');
        expect(chip('xx')?.className).toContain('is-bad');
    });

    it('applies the surviving chain once the bad code is dropped', async () => {
        const onApply = vi.fn();
        await act(async () => {
            render({ settings: { ...DEFAULT_SETTINGS, languages: 'it,xx' }, onApply });
        });

        const remove = chip('xx')?.querySelector('.lang-chip-x') as HTMLButtonElement;
        await act(async () => {
            remove.click();
        });
        expect(applyButton().disabled).toBe(false);

        await act(async () => {
            applyButton().click();
        });
        expect(onApply.mock.calls[0][0].languages).toBe('it');
    });

    it('promotes the clicked code to the front, since only the first one decides', async () => {
        const onApply = vi.fn();
        await act(async () => {
            render({ settings: { ...DEFAULT_SETTINGS, languages: 'it,en' }, onApply });
        });

        await act(async () => {
            (chip('en')?.querySelector('.lang-chip-body') as HTMLButtonElement).click();
        });
        await act(async () => {
            applyButton().click();
        });
        expect(onApply.mock.calls[0][0].languages).toBe('en,it');
    });
});
