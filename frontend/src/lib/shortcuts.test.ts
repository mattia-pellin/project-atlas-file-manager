import { describe, expect, it } from 'vitest';
import { SCAN_CHORD, SHORTCUTS, TRIAGE_CHORD, TRIAGE_ROW_CHORD, TYPE_CHORD } from './shortcuts';

/**
 * A chord something above the page keeps never reaches it, so `preventDefault()` never
 * runs and the shortcut cannot be taken back: triage was on `Ctrl+T` and simply opened a
 * new tab. Two layers do this — the browser, and on this machine the AMD driver overlay,
 * which eats `Ctrl+Shift+G`. Neither can be feature-detected, because in both cases
 * nothing arrives, so the only defence is a list, checked here.
 */

const RESERVED = [
    'mod+t',
    'mod+n',
    'mod+w',
    'mod+shift+t',
    'mod+shift+n',
    'mod+shift+w',
    'mod+q',
    // Taken by the AMD driver overlay, not by the browser. Same effect: never delivered.
    'mod+shift+g'
];

const everyChord = () => SHORTCUTS.flatMap((group) => group.shortcuts.flatMap((s) => [s.chord, s.also ?? '']));

describe('the keymap', () => {
    it('binds nothing the browser will not hand over', () => {
        expect(everyChord().filter((chord) => RESERVED.includes(chord))).toEqual([]);
    });

    it('documents each command exactly once', () => {
        const chords = everyChord().filter(Boolean);
        // `escape` is deliberately in two groups: it means something different in triage.
        const duplicated = chords.filter((chord, index) => chord !== 'escape' && chords.indexOf(chord) !== index);
        expect(duplicated).toEqual([]);
    });

    it('documents the three chords the shell handles', () => {
        for (const chord of [SCAN_CHORD, TRIAGE_CHORD, TRIAGE_ROW_CHORD]) {
            expect(everyChord()).toContain(chord);
        }
    });

    it('keeps the type flip modified and documented', () => {
        // A bare letter is not available: unmodified printable keys type into the cell,
        // which is the whole spreadsheet model. And Ctrl+T never reaches the page.
        expect(TYPE_CHORD).toContain('+');
        expect(RESERVED).not.toContain(TYPE_CHORD);
        expect(everyChord()).toContain(TYPE_CHORD);
    });

    it('keeps scan on Ctrl+R alone — Ctrl+Shift+S never arrived on this keyboard', () => {
        expect(SCAN_CHORD).toBe('mod+r');
        expect(everyChord()).not.toContain('mod+shift+s');
    });

    it('keeps the two triage entries off the chord the AMD overlay eats', () => {
        // Row triage was on `Ctrl+Shift+G` and never fired. The plain modifier goes to the
        // row-local one because it is the entry reached most often.
        expect(TRIAGE_ROW_CHORD).toBe('mod+g');
        expect(TRIAGE_CHORD).toBe('alt+g');
        expect(everyChord()).not.toContain('mod+shift+g');
    });
});
