import { Chord } from './keymap';

/**
 * The keymap, written once.
 *
 * The overlay renders this list and the handlers match against the same strings,
 * so a shortcut cannot be documented as one thing and implemented as another.
 */

export interface Shortcut {
    chord: Chord;
    what: string;
}

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
            { chord: 'mod+r', what: 'Scan the directory' },
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
