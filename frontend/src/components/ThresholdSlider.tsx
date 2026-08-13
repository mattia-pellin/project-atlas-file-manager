import React from 'react';
import { Bands, moveMatch, moveReview } from '../lib/bands';
import { percent } from '../lib/format';

/**
 * The two confidence bands, on one track.
 *
 * They were two separate sliders, which made the thing they actually describe — one
 * axis cut into three — look like two unrelated numbers, and let the user set the pair
 * the backend refuses (`review > match`) and only find out at Apply. Here the two thumbs
 * share the axis and cannot cross, so an impossible pair is not a state that exists.
 *
 * The colours are the row states the bands produce: rust is a row with no name, ochre is
 * a row held for review, green is a row renamed without anyone looking at it. Reading
 * the track is therefore reading what the grid will do.
 *
 * Two native ranges rather than a hand-rolled control, stacked over the painted track:
 * each thumb is a real slider, so arrows, Home/End and a screen reader all work without
 * being reimplemented.
 */

interface ThresholdSliderProps extends Bands {
    onChange: (next: Bands) => void;
}

/** Geometry, not text: the gradient stops keep the decimal the thumbs are placed with. */
const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;

export const ThresholdSlider: React.FC<ThresholdSliderProps> = ({ review, match, onChange }) => {
    // Clamped against each other rather than validated afterwards: the thumb simply
    // stops, which is the only feedback a slider needs.
    const setReview = (value: number) => onChange(moveReview(value, { review, match }));
    const setMatch = (value: number) => onChange(moveMatch(value, { review, match }));

    return (
        <div className="bands">
            <div className="bands-labels">
                <span className="bands-label" style={{ left: pct(review) }}>
                    Proponi <strong className="mono">{percent(review)}</strong>
                </span>
                <span className="bands-label" style={{ left: pct(match) }}>
                    Spunta da solo <strong className="mono">{percent(match)}</strong>
                </span>
            </div>

            <div className="bands-track">
                <div
                    className="bands-fill"
                    aria-hidden="true"
                    style={{
                        background: `linear-gradient(90deg,
                            var(--fault-rust) 0 ${pct(review)},
                            var(--caution-ochre) ${pct(review)} ${pct(match)},
                            var(--band-green) ${pct(match)} 100%)`
                    }}
                />
                <input
                    type="range"
                    className="bands-range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={review}
                    aria-label="Proponi un nome da questo valore in su"
                    onChange={(event) => setReview(Number(event.target.value))}
                />
                <input
                    type="range"
                    className="bands-range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={match}
                    aria-label="Spunta da solo da questo valore in su"
                    onChange={(event) => setMatch(Number(event.target.value))}
                />
            </div>

            <div className="bands-legend" aria-hidden="true">
                <span style={{ width: pct(review) }}>nessun nome proposto</span>
                <span style={{ width: pct(match - review) }}>da rivedere</span>
                <span style={{ width: pct(1 - match) }}>rinominato senza chiedere</span>
            </div>
        </div>
    );
};
