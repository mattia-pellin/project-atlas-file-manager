import { Chord } from './keymap';

/**
 * The keymap, written once.
 *
 * The overlay renders this list and the handlers match against the same strings,
 * so a shortcut cannot be documented as one thing and implemented as another.
 */

export interface Shortcut {
    chord: Chord;
    /** A second chord that does the same thing. Rendered next to the first. */
    also?: Chord;
    what: string;
}

/**
 * Scan, twice.
 *
 * `Ctrl+R` is the chord everyone reaches for and it is the one the browser reloads
 * on; a page that only calls `preventDefault()` is betting on the browser letting it,
 * and when it loses the user gets a reload instead of a rescan. `Ctrl+Shift+S` is
 * claimed by nobody, so it is the one that is documented first — but `Ctrl+R` stays
 * bound, because a reload here costs nothing and a rescan is what was meant.
 */
export const SCAN_CHORDS: readonly [Chord, Chord] = ['mod+shift+s', 'mod+r'];

export interface ShortcutGroup {
    title: string;
    shortcuts: Shortcut[];
}

export const SHORTCUTS: ShortcutGroup[] = [
    {
        title: 'Move',
        shortcuts: [
            { chord: 'arrowup', what: 'Up a row' },
            { chord: 'arrowdown', what: 'Down a row' },
            { chord: 'arrowleft', what: 'Left a column' },
            { chord: 'arrowright', what: 'Right a column' },
            { chord: 'tab', what: 'Next cell' },
            { chord: 'shift+tab', what: 'Previous cell' },
            { chord: 'home', what: 'First column' },
            { chord: 'end', what: 'Last column' },
            { chord: 'mod+home', what: 'First row' },
            { chord: 'mod+end', what: 'Last row' }
        ]
    },
    {
        title: 'Edit',
        shortcuts: [
            { chord: 'f2', what: 'Edit the cell, keeping its value' },
            { chord: 'enter', what: 'Edit the cell — or open triage on the status dot' },
            { chord: 'escape', what: 'Abandon the edit' },
            { chord: 'delete', what: 'Empty the cell' },
            { chord: 'mod+d', what: 'Fill this cell down into every selected row' },
            { chord: 'mod+z', what: 'Undo' },
            { chord: 'mod+shift+z', what: 'Redo' },
            { chord: 'mod+c', what: 'Copy the cell' },
            { chord: 'mod+v', what: 'Paste into the cell' }
        ]
    },
    {
        title: 'Select',
        shortcuts: [
            { chord: 'space', what: 'Tick or untick the row' },
            { chord: 'shift+arrowdown', what: 'Extend the selection' },
            { chord: 'mod+a', what: 'Tick every renameable row' }
        ]
    },
    {
        title: 'Do',
        shortcuts: [
            { chord: 'mod+k', what: 'Command palette' },
            { chord: 'mod+enter', what: 'Rename the selected rows' },
            { chord: SCAN_CHORDS[0], also: SCAN_CHORDS[1], what: 'Scan the directory and match it again' },
            { chord: 'mod+t', what: 'Triage everything the scoring could not settle' },
            { chord: 'mod+,', what: 'Settings' },
            { chord: 'mod+/', what: 'This list' }
        ]
    },
    {
        title: 'In triage',
        shortcuts: [
            { chord: '1', what: 'Pick a candidate (1–9)' },
            { chord: 'a', what: 'Apply the pick to the whole series' },
            { chord: 's', what: 'Skip this file' },
            { chord: 'escape', what: 'Back to the grid' }
        ]
    }
];
