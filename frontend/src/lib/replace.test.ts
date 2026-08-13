import { describe, expect, it } from 'vitest';
import { MediaItem } from '../api';
import { replaceEvery, replacementsFor, ReplaceRequest } from './replace';

/**
 * Find and replace writes the string that reaches the filesystem, so every case here
 * pins an exact name rather than a count.
 */

const row = (id: string, proposed: string | undefined): MediaItem =>
    ({
        id,
        original_name: `${id}.mkv`,
        path: `/media/${id}.mkv`,
        media_type: 'episode',
        status: 'matched',
        proposed_name: proposed
    }) as unknown as MediaItem;

const request = (over: Partial<ReplaceRequest> = {}): ReplaceRequest => ({
    find: '',
    replace: '',
    matchCase: true,
    scope: 'all',
    ...over
});

describe('replaceEvery', () => {
    it('replaces every occurrence, not just the first', () => {
        expect(replaceEvery('Doctor - S01E01 - Doctor.mkv', 'Doctor', 'Dottore', true)).toBe(
            'Dottore - S01E01 - Dottore.mkv'
        );
    });

    it('is literal: a dot matches a dot and nothing else', () => {
        // The whole reason there is no regex mode. As a pattern, `S.H` matches "Sch",
        // "S H" and forty other things nobody looked at before pressing Apply.
        expect(replaceEvery('S.H.I.E.L.D. and SxH.mkv', 'S.H', 'X', true)).toBe('X.I.E.L.D. and SxH.mkv');
    });

    it('takes the replacement literally too', () => {
        // `$&` is "the whole match" to String.replace. Nobody naming a file means that.
        expect(replaceEvery('Serie - S01E01.mkv', 'Serie', 'A$&B', true)).toBe('A$&B - S01E01.mkv');
    });

    it('distinguishes case when asked to, which is the point of the feature', () => {
        expect(replaceEvery('S.H.i.e.L.D.', 'i.e', 'I.E', true)).toBe('S.H.I.E.L.D.');
    });

    it('ignores case when told to, and writes the replacement as typed', () => {
        expect(replaceEvery('the office and The Office', 'the office', 'The Office', false)).toBe(
            'The Office and The Office'
        );
    });

    it('leaves the text alone when there is nothing to find', () => {
        expect(replaceEvery('Doctor Who.mkv', '', 'x', true)).toBe('Doctor Who.mkv');
    });
});

describe('replacementsFor', () => {
    const rows = [
        row('a', 'Doctor Who - S05E01 - The Tomb.mkv'),
        row('b', 'Doctor Who - S05E02 - The Wheel.mkv'),
        row('c', 'Breaking Bad - S01E01 - Pilot.mkv'),
        row('d', undefined)
    ];
    const selected = new Set(['b', 'c', 'd']);

    it('reports only the rows the replacement actually changes', () => {
        const edits = replacementsFor(rows, selected, request({ find: 'Doctor Who', replace: 'Doctor Who (2005)' }));
        expect(edits.map((edit) => edit.id)).toEqual(['a', 'b']);
        expect(edits[0].after).toBe('Doctor Who (2005) - S05E01 - The Tomb.mkv');
    });

    it('narrows to the ticked rows when the scope says so', () => {
        const edits = replacementsFor(
            rows,
            selected,
            request({ find: 'Doctor Who', replace: 'Doctor Who (2005)', scope: 'selected' })
        );
        expect(edits.map((edit) => edit.id)).toEqual(['b']);
    });

    it('skips a row with no proposed name rather than inventing one', () => {
        // A name the API never agreed to must not appear because a search box was open.
        const edits = replacementsFor(rows, selected, request({ find: '', replace: 'Qualcosa' }));
        expect(edits).toEqual([]);
        expect(replacementsFor(rows, selected, request({ find: 'd', replace: 'D' })).some((e) => e.id === 'd')).toBe(
            false
        );
    });

    it('finds nothing when the case does not match and case matters', () => {
        expect(replacementsFor(rows, selected, request({ find: 'doctor who', replace: 'X' }))).toEqual([]);
        expect(
            replacementsFor(rows, selected, request({ find: 'doctor who', replace: 'X', matchCase: false }))
        ).toHaveLength(2);
    });
});
