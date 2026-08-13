// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILD, formatBuiltAt, VERSION } from '../buildinfo';
import { AboutOverlay } from './AboutOverlay';

/**
 * The panel is read to answer one question — is this the build I just deployed? — so
 * what is pinned here is that both identifiers are actually on screen, and that an
 * absent stamp shows as a dash rather than as an empty row that reads like a bug.
 */

let container: HTMLDivElement;
let root: Root;

const render = (onClose: () => void = () => undefined) =>
    act(() => {
        root.render(<AboutOverlay onClose={onClose} />);
    });

const rowValue = (label: string): string | undefined =>
    [...container.querySelectorAll('.about-row')].find((row) => row.querySelector('dt')?.textContent === label)
        ?.querySelector('dd')?.textContent ?? undefined;

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

describe('AboutOverlay', () => {
    it('shows the build number and the version, which answer different questions', () => {
        render();
        expect(container.querySelector('.about-build')?.textContent).toBe(`build ${BUILD}`);
        expect(container.querySelector('.about-version')?.textContent).toBe(VERSION);
    });

    it('prints a dash for a stamp the build did not leave, rather than an empty row', () => {
        // Under vitest there is no image build, so both stamps are absent — which is
        // exactly the dev-server case the panel has to render without looking broken.
        render();
        expect(rowValue('Commit')).toBe('—');
        expect(rowValue('Compilato')).toBe('—');
    });

    it('closes on Escape', () => {
        const onClose = vi.fn();
        render(onClose);
        act(() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        });
        expect(onClose).toHaveBeenCalled();
    });
});

describe('formatBuiltAt', () => {
    it('has nothing to say about an absent or unparseable stamp', () => {
        expect(formatBuiltAt('')).toBeNull();
        expect(formatBuiltAt('not a date')).toBeNull();
    });

    it('renders an ISO stamp in the reader’s own locale', () => {
        expect(formatBuiltAt('2026-08-13T10:00:00Z')).toContain('2026');
    });
});
