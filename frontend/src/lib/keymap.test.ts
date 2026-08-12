import { describe, expect, it } from 'vitest';
import { isTypingKey, matchesChord } from './keymap';

/**
 * The one rule that has to hold: a chord and a character are never the same event.
 * If they were, typing into a cell would fire a command — which is exactly how a
 * keyboard-first grid becomes unusable.
 */

const press = (key: string, modifiers: Partial<KeyboardEventInit> = {}): KeyboardEvent =>
    new KeyboardEvent('keydown', { key, ...modifiers });

describe('matchesChord', () => {
    it('matches a bare key only when no modifier is held', () => {
        expect(matchesChord(press('Enter'), 'enter')).toBe(true);
        expect(matchesChord(press('Enter', { ctrlKey: true }), 'enter')).toBe(false);
    });

    it('treats ctrl and cmd as the same "mod"', () => {
        expect(matchesChord(press('d', { ctrlKey: true }), 'mod+d')).toBe(true);
        expect(matchesChord(press('d', { metaKey: true }), 'mod+d')).toBe(true);
        expect(matchesChord(press('d'), 'mod+d')).toBe(false);
    });

    it('distinguishes a chord from the same chord with shift', () => {
        expect(matchesChord(press('z', { ctrlKey: true }), 'mod+shift+z')).toBe(false);
        expect(matchesChord(press('z', { ctrlKey: true, shiftKey: true }), 'mod+shift+z')).toBe(true);
        expect(matchesChord(press('z', { ctrlKey: true, shiftKey: true }), 'mod+z')).toBe(false);
    });

    it('spells the space bar as "space"', () => {
        expect(matchesChord(press(' '), 'space')).toBe(true);
    });
});

describe('isTypingKey', () => {
    it('is true for a printable character with no modifier', () => {
        expect(isTypingKey(press('a'))).toBe(true);
        expect(isTypingKey(press('7'))).toBe(true);
        expect(isTypingKey(press('è'))).toBe(true);
    });

    it('is false for anything that could be a command or a movement', () => {
        expect(isTypingKey(press('a', { ctrlKey: true }))).toBe(false);
        expect(isTypingKey(press('ArrowDown'))).toBe(false);
        expect(isTypingKey(press('F2'))).toBe(false);
        // Space selects the row; it must never open an editor.
        expect(isTypingKey(press(' '))).toBe(false);
    });
});
