// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CommandBar } from './CommandBar';

/**
 * The bar must hold still while work runs.
 *
 * Every label in it carries a number that moves during a scan — the progress count, the
 * triage pip, the ticked total — and each one used to resize its button and shove the
 * other two sideways. The fix is a hidden copy of every state the verb can be in, so
 * what is pinned here is that the copies exist and that they are sized for three digits.
 */

let container: HTMLDivElement;
let root: Root;

const counts = { total: 0, matched: 0, review: 0, error: 0, selected: 0 };

const render = (props: Partial<React.ComponentProps<typeof CommandBar>> = {}) =>
    act(() => {
        root.render(
            <CommandBar
                directory="/media"
                onDirectoryChange={() => undefined}
                busy={null}
                counts={counts}
                onScan={() => undefined}
                onTriage={() => undefined}
                onRename={() => undefined}
                onSettings={() => undefined}
                onKeymap={() => undefined}
                onAbout={() => undefined}
                {...props}
            />
        );
    });

/** The hidden states of each verb, in bar order: scan, triage, rename. */
const ghosts = () =>
    [...container.querySelectorAll('.verb')].map((verb) =>
        [...verb.querySelectorAll('.verb-ghost')].map((ghost) => ghost.textContent ?? '')
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

describe('CommandBar', () => {
    it('reserves three digits for every count a verb can print', () => {
        render();
        // Not just the busy labels: the idle ones count too. Triage's pip is absent at
        // zero and appears mid-scan, which is the resize this list exists to absorb.
        expect(ghosts().map((states) => states.filter((text) => text.includes('888')).length)).toEqual([1, 1, 2]);
    });

    it('keeps a hidden copy of the label it is not currently showing', () => {
        render({ busy: { verb: 'scan', label: 'Analisi', done: 7, total: 16 } });
        const [scan] = ghosts();
        expect(scan.some((text) => text.includes('Scansiona'))).toBe(true);
    });

    it('hides those copies from the accessible name', () => {
        render();
        const hidden = [...container.querySelectorAll('.verb-ghost')];
        expect(hidden.length).toBeGreaterThan(0);
        expect(hidden.every((ghost) => ghost.getAttribute('aria-hidden') === 'true')).toBe(true);
    });
});
