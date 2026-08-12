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

/** Words for a screen reader, where a glyph is either silent or read as punctuation. */
const SPOKEN: Record<string, string> = {
    arrowup: 'Up arrow',
    arrowdown: 'Down arrow',
    arrowleft: 'Left arrow',
    arrowright: 'Right arrow',
    enter: 'Enter',
    escape: 'Escape',
    space: 'Space',
    backspace: 'Backspace',
    delete: 'Delete'
};

const titleCase = (part: string): string =>
    part.length === 1 ? part.toUpperCase() : part.replace(/^./, (c) => c.toUpperCase());

export const chordSeparator = (): string => (isMac() ? '' : '+');

/**
 * A chord broken into the pieces a `<kbd>` draws, one per key.
 *
 * `token` is the raw part, so a renderer can swap in an icon for the keys whose
 * glyph does not sit on the text baseline — `↵` above all, which is drawn a third
 * of a line lower than the letters beside it in most monospace faces and makes a
 * chord look broken. `label` is the fallback text and stays authoritative for
 * everything else.
 */
export interface ChordPart {
    token: string;
    label: string;
}

export const chordParts = (chord: Chord): ChordPart[] =>
    chord.split('+').map((token) => {
        if (token === 'mod') return { token, label: isMac() ? '⌘' : 'Ctrl' };
        if (token === 'shift') return { token, label: isMac() ? '⇧' : 'Shift' };
        if (token === 'alt') return { token, label: isMac() ? '⌥' : 'Alt' };
        return { token, label: SYMBOLS[token] ?? titleCase(token) };
    });

export const formatChord = (chord: Chord): string =>
    chordParts(chord)
        .map((part) => part.label)
        .join(chordSeparator());

/** The chord spelled out, for `aria-label` and `title`. */
export const describeChord = (chord: Chord): string =>
    chord
        .split('+')
        .map((part) => {
            if (part === 'mod') return isMac() ? 'Command' : 'Control';
            if (part === 'shift') return 'Shift';
            if (part === 'alt') return isMac() ? 'Option' : 'Alt';
            return SPOKEN[part] ?? titleCase(part);
        })
        .join(' ');

/**
 * Keys that must never start an edit.
 *
 * Type-to-edit is the whole reason the grid feels like a spreadsheet, so the test
 * is deliberately generous — one printable character with no modifier — and this
 * is the exception list.
 */
export const isTypingKey = (event: KeyboardEvent | React.KeyboardEvent): boolean =>
    event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== ' ';
