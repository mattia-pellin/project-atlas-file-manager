import { describe, expect, it } from 'vitest';
import { SCAN_CHORD, SHORTCUTS, TRIAGE_CHORD, TRIAGE_ROW_CHORD } from './shortcuts';

/**
 * A chord the browser keeps never reaches the page, so `preventDefault()` never runs
 * and the shortcut cannot be taken back: triage was on `Ctrl+T` and simply opened a new
 * tab. There is no feature detection for this — the event does not arrive — so the only
 * defence is a list, checked here.
 */

const RESERVED = ['mod+t', 'mod+n', 'mod+w', 'mod+shift+t', 'mod+shift+n', 'mod+shift+w', 'mod+q'];

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

    it('keeps scan on Ctrl+R alone — Ctrl+Shift+S never arrived on this keyboard', () => {
        expect(SCAN_CHORD).toBe('mod+r');
        expect(everyChord()).not.toContain('mod+shift+s');
    });
});
