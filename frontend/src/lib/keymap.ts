/**
 * Chords, matched and displayed from one string.
 *
 * The overlay that documents a shortcut and the handler that implements it read
 * the same value, so the help cannot drift from the behaviour — which is the usual
 * way a keyboard-first app stops being one.
 *
 * `mod` is ctrl on Linux/Windows and cmd on macOS.
 */

export type Chord = string;

const isMac = (): boolean => typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || '');

export const matchesChord = (event: KeyboardEvent | React.KeyboardEvent, chord: Chord): boolean => {
    const parts = chord.toLowerCase().split('+');
    const key = parts[parts.length - 1];
    const wants = {
        mod: parts.includes('mod'),
        ctrl: parts.includes('ctrl'),
        shift: parts.includes('shift'),
        alt: parts.includes('alt')
    };

    const pressedKey = event.key.toLowerCase();
    const normalized = pressedKey === ' ' ? 'space' : pressedKey;
    if (normalized !== key) return false;

    const mod = event.ctrlKey || event.metaKey;
    if (wants.mod !== mod) return false;
    if (!wants.mod && wants.ctrl !== event.ctrlKey) return false;
    if (wants.shift !== event.shiftKey) return false;
    if (wants.alt !== event.altKey) return false;
    return true;
};

const SYMBOLS: Record<string, string> = {
    arrowup: '↑',
    arrowdown: '↓',
    arrowleft: '←',
    arrowright: '→',
    enter: '↵',
    escape: 'Esc',
    space: 'Space',
    backspace: '⌫',
    delete: 'Del'
};

export const formatChord = (chord: Chord): string =>
    chord
        .split('+')
        .map((part) => {
            if (part === 'mod') return isMac() ? '⌘' : 'Ctrl';
            if (part === 'shift') return isMac() ? '⇧' : 'Shift';
            if (part === 'alt') return isMac() ? '⌥' : 'Alt';
            return SYMBOLS[part] ?? (part.length === 1 ? part.toUpperCase() : part.replace(/^./, (c) => c.toUpperCase()));
        })
        .join(isMac() ? '' : '+');

/**
 * Keys that must never start an edit.
 *
 * Type-to-edit is the whole reason the grid feels like a spreadsheet, so the test
 * is deliberately generous — one printable character with no modifier — and this
 * is the exception list.
 */
export const isTypingKey = (event: KeyboardEvent | React.KeyboardEvent): boolean =>
    event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== ' ';
