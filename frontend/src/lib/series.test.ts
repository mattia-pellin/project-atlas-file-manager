import { describe, expect, it } from 'vitest';
import { MediaItem } from '../api';
import { needsTriage, sameSeries, seriesKey } from './series';

/**
 * Grouping decides how far one triage answer travels. Too narrow and the user answers
 * the same question twenty-four times; too wide and one pick renames a series nobody
 * was looking at, which is the expensive direction.
 */

const item = (overrides: Partial<MediaItem> = {}): MediaItem => ({
    id: '1',
    original_path: '/media/x.mkv',
    original_name: 'x.mkv',
    media_type: 'episode',
    clean_title: 'One Piece',
    season: 1,
    episode: 10,
    status: 'review',
    ...overrides
});

describe('seriesKey', () => {
    it('ignores case, accents, apostrophes and punctuation', () => {
        // Elisions are closed up, not split, exactly as `matching.normalize_title` does
        // — this library is full of them and the two sides have to agree.
        expect(seriesKey(item({ clean_title: "L'Ispettore Coliandro" }))).toBe('lispettore coliandro');
        expect(seriesKey(item({ clean_title: 'Pokémon' }))).toBe(seriesKey(item({ clean_title: 'Pokemon' })));
        expect(seriesKey(item({ clean_title: 'Doctor Who!' }))).toBe(seriesKey(item({ clean_title: 'doctor who' })));
    });

    it('has no key for a movie, or for a title that is empty', () => {
        expect(seriesKey(item({ media_type: 'movie' }))).toBeNull();
        expect(seriesKey(item({ clean_title: '   ' }))).toBeNull();
    });
});

describe('sameSeries', () => {
    it('gathers every episode of the same show, whatever each one matched', () => {
        const rows = [
            item({ id: '1', tvdb_id: 81797 }),
            item({ id: '2', tvdb_id: 424435 }),
            item({ id: '3', clean_title: 'Breaking Bad' }),
            item({ id: '4', clean_title: 'ONE PIECE' })
        ];
        // Grouped on the title, never on the matched id: the rows that need the fix are
        // precisely the ones currently pointing at the wrong series.
        expect(sameSeries(rows, rows[0]).map((row) => row.id)).toEqual(['1', '2', '4']);
    });

    it('leaves a movie on its own — two films sharing a title are two films', () => {
        const rows = [item({ id: '1', media_type: 'movie', clean_title: 'The Matrix' }), item({ id: '2', media_type: 'movie', clean_title: 'The Matrix' })];
        expect(sameSeries(rows, rows[0]).map((row) => row.id)).toEqual(['1']);
    });
});

describe('needsTriage', () => {
    it('queues the unsettled rows that actually have something to choose from', () => {
        const candidate = { key: '1', label: 'One Piece', source: 'tvdb' as const, score: 0.5, title_score: 1, year_factor: 1, selected: true };
        const rows = [
            item({ id: '1', status: 'review', candidates: [candidate] }),
            item({ id: '2', status: 'error', candidates: [candidate] }),
            // Nothing to pick from, so triage has nothing to offer.
            item({ id: '3', status: 'error', candidates: [] }),
            item({ id: '4', status: 'matched', candidates: [candidate] })
        ];
        expect(needsTriage(rows).map((row) => row.id)).toEqual(['1', '2']);
    });
});
