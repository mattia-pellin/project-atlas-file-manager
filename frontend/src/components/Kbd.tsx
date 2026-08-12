import { Fragment } from 'react';
import { Chord, chordParts, chordSeparator, describeChord } from '../lib/keymap';

/**
 * One key cap per chord, drawn from the chord string.
 *
 * The reason this is a component and not `{formatChord(chord)}` in a `<kbd>` is the
 * return glyph: `↵` has no cap height in any of the fonts here, so it hangs below the
 * letters next to it and a `Ctrl+↵` chip reads as misprinted. Drawing it as an SVG
 * sized in `em` puts it on the same optical line as `Ctrl`, at every text size.
 */

const EnterGlyph = () => (
    <svg className="kbd-glyph" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
        <path d="M8.6 1.6v3.8H2.2" />
        <path d="M4.3 3.3 2.2 5.4l2.1 2.1" />
    </svg>
);

export const Kbd = ({ chord }: { chord: Chord }) => {
    const separator = chordSeparator();
    return (
        <kbd aria-label={describeChord(chord)}>
            {chordParts(chord).map((part, index) => (
                <Fragment key={`${part.token}-${index}`}>
                    {index > 0 && separator ? (
                        <span className="kbd-sep" aria-hidden="true">
                            {separator}
                        </span>
                    ) : null}
                    {part.token === 'enter' ? <EnterGlyph /> : <span aria-hidden="true">{part.label}</span>}
                </Fragment>
            ))}
        </kbd>
    );
};
