import { Chord } from './keymap';

/**
 * The keymap, written once.
 *
 * The overlay renders this list and the handlers match against the same strings,
 * so a shortcut cannot be documented as one thing and implemented as another.
 *
 * The labels are Italian because the overlay is; the chord strings are not, and must
 * stay the lowercase `KeyboardEvent.key` spellings `matchesChord` compares against.
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
 * Triage for the whole queue.
 *
 * `Alt+G`, not `Ctrl+G`, and certainly not `Ctrl+T`. Every chord here has to survive
 * two layers that sit above the page: the browser, which keeps `Ctrl+T` without
 * delivering the event at all, and — on this machine — the AMD driver overlay, which
 * swallows `Ctrl+Shift+G` the same way. Neither can be feature-detected, because in
 * both cases nothing arrives; the only defence is the list in `shortcuts.test.ts`.
 */
export const TRIAGE_CHORD: Chord = 'alt+g';

/**
 * Triage the focused row alone, whatever its status — the answer usually needed.
 *
 * `Ctrl+G` is nominally "find again", which is preventable and means nothing here with
 * no find bar open. It has the plain modifier because it is the one reached most often.
 */
export const TRIAGE_ROW_CHORD: Chord = 'mod+g';

/**
 * Flip the focused row between movie and episode, from any column.
 *
 * Wrong type is the correction most often needed — it decides which API is even asked —
 * and walking to the Type column to press Enter is three keystrokes of tax on it.
 *
 * `Alt` rather than `Ctrl` because the useful unshifted `Ctrl+letter`s are gone: `Ctrl+T`
 * the browser keeps, `Ctrl+E` is the omnibox, `Ctrl+M` mutes the tab in Firefox, and
 * `Ctrl+C`/`Ctrl+V` are the clipboard. A bare letter is not available either: bare
 * printable keys type into the cell, which is the whole spreadsheet model.
 */
export const TYPE_CHORD: Chord = 'alt+c';

/**
 * Find and replace, over the proposed names.
 *
 * `Ctrl+H` is find-and-replace in every spreadsheet — including the Google Sheet this
 * tool replaced, which is where the muscle memory comes from. It is also one of the few
 * `Ctrl+letter`s that is genuinely preventable: Sheets and Docs both bind it and both
 * work in Chrome and Firefox, which is the only evidence worth having after `Ctrl+T`
 * (never delivered) and `Ctrl+Shift+S` (never arrives on this keyboard).
 */
export const REPLACE_CHORD: Chord = 'mod+h';

export interface ShortcutGroup {
    title: string;
    shortcuts: Shortcut[];
}

export const SHORTCUTS: ShortcutGroup[] = [
    {
        title: 'Spostarsi',
        shortcuts: [
            { chord: 'arrowup', what: 'Riga sopra' },
            { chord: 'arrowdown', what: 'Riga sotto' },
            { chord: 'arrowleft', what: 'Colonna a sinistra' },
            { chord: 'arrowright', what: 'Colonna a destra' },
            { chord: 'tab', what: 'Cella successiva' },
            { chord: 'shift+tab', what: 'Cella precedente' },
            { chord: 'home', what: 'Prima colonna' },
            { chord: 'end', what: 'Ultima colonna' },
            { chord: 'mod+home', what: 'Prima riga' },
            { chord: 'mod+end', what: 'Ultima riga' }
        ]
    },
    {
        title: 'Modificare',
        shortcuts: [
            { chord: 'f2', what: 'Modifica la cella mantenendone il valore' },
            { chord: 'enter', what: 'Modifica la cella — o apre il triage sul pallino di stato' },
            { chord: 'escape', what: 'Abbandona la modifica' },
            { chord: 'delete', what: 'Svuota la cella, o tutte quelle selezionate' },
            { chord: TYPE_CHORD, what: 'Alterna questa riga fra film ed episodio' },
            { chord: 'mod+d', what: 'Ricopia questa cella nelle righe selezionate' },
            { chord: 'mod+z', what: 'Annulla' },
            { chord: 'mod+shift+z', what: 'Ripristina' },
            { chord: 'mod+c', what: 'Copia la cella' },
            { chord: 'mod+v', what: 'Incolla nella cella, o in tutte quelle selezionate' },
            { chord: REPLACE_CHORD, what: 'Trova e sostituisci nei nomi proposti' }
        ]
    },
    {
        title: 'Selezionare',
        shortcuts: [
            { chord: 'space', what: 'Spunta o toglie la spunta alla riga' },
            { chord: 'shift+arrowdown', what: 'Estende la selezione verticale di celle, e spunta le righe' },
            { chord: 'mod+a', what: 'Spunta ogni riga rinominabile' }
        ]
    },
    {
        title: 'Agire',
        shortcuts: [
            { chord: 'mod+k', what: 'Tavolozza dei comandi' },
            { chord: 'mod+enter', what: 'Rinomina le righe spuntate' },
            { chord: SCAN_CHORD, what: 'Scansiona la cartella e riabbina tutto' },
            { chord: TRIAGE_CHORD, what: 'Triage di tutto ciò che il punteggio non ha risolto' },
            { chord: TRIAGE_ROW_CHORD, what: 'Triage solo di questa riga' },
            { chord: 'mod+,', what: 'Impostazioni' },
            { chord: 'mod+/', what: 'Questo elenco' }
        ]
    },
    {
        title: 'Nel triage',
        shortcuts: [
            { chord: '1', what: 'Sceglie un candidato (1–9)' },
            { chord: 'a', what: 'Applica la scelta a tutta la serie' },
            { chord: 's', what: 'Salta questo file' },
            { chord: 'escape', what: 'Torna alla griglia' }
        ]
    }
];
