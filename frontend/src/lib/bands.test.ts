import { describe, expect, it } from 'vitest';
import { MIN_GAP, moveMatch, moveReview } from './bands';

/**
 * The pair the backend refuses must not be a state the control can reach.
 *
 * `review > match` is a 400 from `/api/analyze` — on every row, so it presents as "the
 * app is broken" rather than as "this setting is wrong". Two separate sliders could
 * produce it and only complain at Apply; one track with two thumbs cannot.
 */

describe('moveReview', () => {
    it('moves freely below the other thumb', () => {
        expect(moveReview(0.6, { review: 0.45, match: 0.75 })).toEqual({ review: 0.6, match: 0.75 });
    });

    it('stops a gap short of it instead of crossing', () => {
        expect(moveReview(0.9, { review: 0.45, match: 0.75 })).toEqual({ review: 0.75 - MIN_GAP, match: 0.75 });
    });

    it('never goes below zero, even against a thumb at the bottom', () => {
        expect(moveReview(0.5, { review: 0, match: MIN_GAP }).review).toBe(0);
    });
});

describe('moveMatch', () => {
    it('moves freely above the other thumb', () => {
        expect(moveMatch(0.9, { review: 0.45, match: 0.75 })).toEqual({ review: 0.45, match: 0.9 });
    });

    it('stops a gap short of it instead of crossing', () => {
        expect(moveMatch(0.1, { review: 0.45, match: 0.75 })).toEqual({ review: 0.45, match: 0.45 + MIN_GAP });
    });

    it('never goes above one', () => {
        expect(moveMatch(0.5, { review: 1, match: 1 }).match).toBe(1);
    });
});

describe('the two together', () => {
    it('cannot be driven into an equal pair from either side', () => {
        let bands = { review: 0.45, match: 0.75 };
        for (const target of [1, 0, 1, 0]) {
            bands = moveReview(target, bands);
            bands = moveMatch(target, bands);
            expect(bands.match).toBeGreaterThan(bands.review);
        }
    });
});
