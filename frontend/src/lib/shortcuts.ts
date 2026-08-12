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
 * Scan.
 *
 * `Ctrl+R` and nothing else. It was also bound to `Ctrl+Shift+S`, on the theory that
 * a chord the browser does not claim is the safer one to document — but that chord
 * does not arrive at all on the keyboard layout this is used with, so the safer
 * option was the one that did not work. `Ctrl+R` is preventable everywhere, and the
 * worst case if a browser ever refuses is a page reload.
 */
export const SCAN_CHORD: Chord = 'mod+r';

/**
 * Triage, for the queue and for one row.
 *
 * Not `Ctrl+T`: Chrome and Firefox open a new tab on it and do not deliver the event
 * to the page at all, so `preventDefault()` never runs and the shortcut cannot be
 * taken back. `Ctrl+G` is only ever "find again", which is preventable, and there is
 * no find bar open here for it to mean anything.
 */
export const TRIAGE_CHORD: Chord = 'mod+g';

/** Triage the focused row alone, whatever its status — the answer usually needed. */
export const TRIAGE_ROW_CHORD: Chord = 'mod+shift+g';

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
            { chord: SCAN_CHORD, what: 'Scan the directory and match it again' },
            { chord: TRIAGE_CHORD, what: 'Triage everything the scoring could not settle' },
            { chord: TRIAGE_ROW_CHORD, what: 'Triage this row on its own' },
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
