/**
 * The two confidence bands, and the one rule that holds them apart.
 *
 * Pure and separate from the slider that draws them: `review > match` is a 400 from
 * `/api/analyze` on every single row, which presents as "the app is broken" rather than
 * as "this setting is wrong", so the clamping is worth testing without a DOM.
 */

/** The smallest gap between the thumbs. Equal thresholds would make `review` an empty band. */
export const MIN_GAP = 0.01;

export interface Bands {
    /** Below this, no name is proposed at all. */
    review: number;
    /** At or above this, the row is ticked for rename unattended. */
    match: number;
}

const clamp = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * Where each thumb ends up once the other one is taken into account.
 *
 * Pure, and exported for the tests, because this is the rule the whole control exists to
 * enforce: `review > match` is a 400 from `/api/analyze` on every single row, and the
 * old pair of sliders could produce it and only say so at Apply.
 */
export const moveReview = (value: number, { match }: Bands): Bands => ({
    review: clamp(Math.min(value, match - MIN_GAP)),
    match
});

export const moveMatch = (value: number, { review }: Bands): Bands => ({
    review,
    match: clamp(Math.max(value, review + MIN_GAP))
});

