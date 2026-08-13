import React from 'react';
import { describeChord, formatChord } from '../lib/keymap';
import { SCAN_CHORD, TRIAGE_CHORD } from '../lib/shortcuts';
import { Kbd } from './Kbd';

/**
 * One line at the top of the screen, and nothing else.
 *
 * Design C has no sidebar, so this bar carries where to scan, the progress of
 * whatever is running, and the two irreversible-ish actions. The counts live in the
 * status bar at the foot of the screen, next to the keys for the current mode — the
 * batch's state and the way to act on it read better together than split across two
 * ends of the window. Everything rarer lives behind Ctrl+K.
 */

export interface Counts {
    total: number;
    matched: number;
    review: number;
    error: number;
    selected: number;
}

/**
 * What is running, and which verb owns it.
 *
 * Progress is printed *inside* that verb's own button, replacing its label, and nowhere
 * else. It used to be a free-standing `Analisi 12/40` between the path box and the
 * buttons, which grew and shrank on every answer and shoved the whole bar sideways
 * while it did. A button is a box that already exists, is already the right width, and
 * is already disabled while the work runs — so the progress reads as "this verb is
 * busy" rather than as a caption floating next to it.
 */
export interface Busy {
    verb: 'scan' | 'triage' | 'rename';
    /** Short enough to fit a button: `Analisi`, `Riabbino`, `Applico`. */
    label: string;
    /** The long version, for the tooltip — which series is being applied, say. */
    detail?: string;
    done?: number;
    total?: number;
}

/**
 * `12/40`, with the running number padded to the width of the total.
 *
 * The count is mono and `white-space: pre`, so 9→10 does not widen the button and slide
 * the label under it. Everything in the bar holds still for the whole run.
 */
const BusyLabel: React.FC<{ busy: Busy }> = ({ busy }) => (
    <>
        {busy.label}
        {busy.done !== undefined && busy.total !== undefined && (
            <span className="mono busy-count">
                {`${String(busy.done).padStart(String(busy.total).length, ' ')}/${busy.total}`}
            </span>
        )}
    </>
);

/**
 * Three digits, in every count a verb can print. A library of up to 999 files therefore
 * never resizes the bar; a bigger one widens it once, on the first answer, and holds.
 */
const WIDE = 888;

/** Each verb's label, at whatever count — so the ghost below cannot drift from the face. */
const scanFace = (
    <>
        Scansiona
        <Kbd chord={SCAN_CHORD} />
    </>
);

const triageFace = (unsettled: number) => (
    <>
        Triage
        {unsettled > 0 && <span className="pip mono">{unsettled}</span>}
        <Kbd chord={TRIAGE_CHORD} />
    </>
);

const renameFace = (selected: number) => (
    <>
        Rinomina<span className="mono"> {selected}</span>
        <Kbd chord="mod+enter" />
    </>
);

/**
 * Holds a verb at one width for the whole session.
 *
 * A `min-width` was tried and is a guess: it has to be re-measured by hand every time a
 * label changes, and it was already too small for `Analisi 100/236`, so the button grew
 * mid-scan and shoved the two beside it sideways — the exact reflow moving the progress
 * into the button was supposed to end. Instead *every* state the verb can be in is
 * rendered underneath the real one, hidden, in the same grid cell: the box is then the
 * widest of them by construction, and it cannot be out of date.
 *
 * `widest` must list them all, the idle label included. The counts in it are what move —
 * the first version of this held only the busy labels, so Triage still grew as its pip
 * appeared and went from one digit to two while the scan filled the grid behind it.
 */
const Verb: React.FC<{ widest: React.ReactNode[]; children: React.ReactNode }> = ({ widest, children }) => (
    <span className="verb">
        <span className="verb-face">{children}</span>
        {widest.map((state, index) => (
            <span key={index} className="verb-ghost" aria-hidden="true">
                {state}
            </span>
        ))}
    </span>
);

interface CommandBarProps {
    directory: string;
    onDirectoryChange: (directory: string) => void;
    busy: Busy | null;
    counts: Counts;
    onScan: () => void;
    onTriage: () => void;
    onRename: () => void;
    onSettings: () => void;
    onKeymap: () => void;
    onAbout: () => void;
}

export const CommandBar: React.FC<CommandBarProps> = ({
    directory,
    onDirectoryChange,
    busy,
    counts,
    onScan,
    onTriage,
    onRename,
    onSettings,
    onKeymap,
    onAbout
}) => (
    <header className="bar">
        <span className="brand">
            <span className="brand-dot" aria-hidden="true" />
            <span className="brand-name">Project: Atlas</span> <span className="brand-dash">-</span>{' '}
            <span className="brand-suffix">Files</span>
        </span>

        {/* The path box is its own form so Enter in it scans, but its button is not
            inside it: the three actions have to sit together, evenly spaced, and a
            submit button reaches its form by id from anywhere on the page. */}
        <form
            id="scan-form"
            className="bar-path"
            onSubmit={(event) => {
                event.preventDefault();
                onScan();
            }}
        >
            <input
                className="input mono"
                value={directory}
                spellCheck={false}
                aria-label="Cartella da scansionare"
                onChange={(event) => onDirectoryChange(event.target.value)}
            />
        </form>

        {/* One live region for the three of them: whichever button is carrying the
            progress, its text is what changes, so that is what gets announced. */}
        <div className="bar-actions" aria-live="polite">
            {/* Scansiona is also where every *analysis* reports — a rematch after a cell
                edit, a triage pick replayed over a season — because this is the button
                that abbina, and because a scan is precisely what must not start on top
                of one. Disabled, amber, and a fixed slot it cannot outgrow. */}
            <button
                type="submit"
                form="scan-form"
                className={`button${busy?.verb === 'scan' ? ' is-busy' : ''}`}
                disabled={busy !== null}
                title={
                    busy?.verb === 'scan'
                        ? (busy.detail ?? busy.label)
                        : `Scansiona e abbina (${describeChord(SCAN_CHORD)})`
                }
            >
                <Verb
                    widest={[
                        scanFace,
                        // `Riabbino` is the longest of the four labels this button
                        // carries — the others are `Scansione…`, `Analisi`, `Applico`.
                        <BusyLabel key="busy" busy={{ verb: 'scan', label: 'Riabbino', done: WIDE, total: WIDE }} />
                    ]}
                >
                    {busy?.verb === 'scan' ? <BusyLabel busy={busy} /> : scanFace}
                </Verb>
            </button>
            <button
                type="button"
                className={`button ghost${busy?.verb === 'triage' ? ' is-busy' : ''}`}
                onClick={onTriage}
                disabled={busy !== null || counts.review + counts.error === 0}
                title={busy?.verb === 'triage' ? (busy.detail ?? busy.label) : `Triage (${describeChord(TRIAGE_CHORD)})`}
            >
                <Verb
                    widest={[
                        // The pip is the moving part here: it is absent at zero and grows
                        // a digit at a time while the scan behind it finds unsettled rows.
                        triageFace(WIDE),
                        <BusyLabel key="busy" busy={{ verb: 'triage', label: 'Cerco…' }} />
                    ]}
                >
                    {busy?.verb === 'triage' ? <BusyLabel busy={busy} /> : triageFace(counts.review + counts.error)}
                </Verb>
            </button>
            <button
                type="button"
                className={`button primary${busy?.verb === 'rename' ? ' is-busy' : ''}`}
                onClick={onRename}
                disabled={busy !== null || counts.selected === 0}
                title={
                    busy?.verb === 'rename'
                        ? (busy.detail ?? busy.label)
                        : `Rinomina le righe spuntate (${describeChord('mod+enter')})`
                }
            >
                <Verb
                    widest={[
                        // Ticking the confident rows happens *during* the scan, so this
                        // count moves for the same reason the pip beside it does.
                        renameFace(WIDE),
                        <BusyLabel key="busy" busy={{ verb: 'rename', label: 'Rinomino', done: WIDE, total: WIDE }} />
                    ]}
                >
                    {busy?.verb === 'rename' ? <BusyLabel busy={busy} /> : renameFace(counts.selected)}
                </Verb>
            </button>
        </div>

        {/* The three icons are not verbs and are not in the rhythm the three share: they
            open a panel and they stay pinned to the right edge. */}
        <div className="bar-tools">
            <button
                type="button"
                className="icon-button"
                onClick={onSettings}
                aria-label="Impostazioni"
                title={formatChord('mod+,')}
            >
                {/* A cogwheel: eight teeth, every coordinate on a circle about (12,12) —
                    tips at r=10.5, roots at r=7.3, 45° apart. The path this replaces was
                    drawn by hand and its teeth were neither the same size nor evenly
                    spaced, which is what made the icon look bent. */}
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                        d="M10.11 4.95L10.00 1.69L14.00 1.69L13.89 4.95A7.3 7.3 0 0 1 15.65 5.68L17.87 3.30L20.70 6.13L18.32 8.35A7.3 7.3 0 0 1 19.05 10.11L22.31 10.00L22.31 14.00L19.05 13.89A7.3 7.3 0 0 1 18.32 15.65L20.70 17.87L17.87 20.70L15.65 18.32A7.3 7.3 0 0 1 13.89 19.05L14.00 22.31L10.00 22.31L10.11 19.05A7.3 7.3 0 0 1 8.35 18.32L6.13 20.70L3.30 17.87L5.68 15.65A7.3 7.3 0 0 1 4.95 13.89L1.69 14.00L1.69 10.00L4.95 10.11A7.3 7.3 0 0 1 5.68 8.35L3.30 6.13L6.13 3.30L8.35 5.68A7.3 7.3 0 0 1 10.11 4.95Z"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinejoin="round"
                    />
                    <circle cx="12" cy="12" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
                </svg>
            </button>
            <button
                type="button"
                className="icon-button"
                onClick={onKeymap}
                aria-label="Scorciatoie da tastiera"
                title={formatChord('mod+/')}
            >
                <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="1.6" y="5.6" width="20.8" height="12.8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
                    <path
                        d="M5.8 9.9h1.3M9.6 9.9h1.3M13.4 9.9h1.3M17.2 9.9h1.3M7.4 14.1h9.2"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                    />
                </svg>
            </button>
            {/* Last, and deliberately without a chord: it answers a question asked after
                a deploy, not during the work, and every free `Ctrl`+letter is spent. */}
            <button
                type="button"
                className="icon-button"
                onClick={onAbout}
                aria-label="Versione e build"
                title="Versione e build"
            >
                {/* The bar and the tittle are separate strokes, both round-capped, so the
                    `i` keeps its gap at 17px instead of fusing into one mark. */}
                <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="12" r="9.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
                    <path
                        d="M12 11.2v5.4M12 7.6v0.1"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                    />
                </svg>
            </button>
        </div>
    </header>
);
