import { describe, expect, it } from 'vitest';
import { MediaItem } from '../api';
import { sortRows } from './sort';

const row = (overrides: Partial<MediaItem> = {}): MediaItem => ({
    id: overrides.id ?? overrides.original_name ?? 'x',
    original_path: `/media/${overrides.original_name ?? 'x'}`,
    original_name: overrides.original_name ?? 'x',
    media_type: 'episode',
    clean_title: 'Show',
    status: 'pending',
    ...overrides
});

const names = (rows: MediaItem[]): string[] => rows.map((item) => item.original_name);

describe('sortRows', () => {
    it('puts every movie above every episode', () => {
        const sorted = sortRows([
            row({ original_name: 'e', media_type: 'episode', clean_title: 'Alpha' }),
            row({ original_name: 'm', media_type: 'movie', clean_title: 'Zulu' })
        ]);
        expect(names(sorted)).toEqual(['m', 'e']);
    });

    it('sorts a season into episode order, not into the order the walk found it', () => {
        const sorted = sortRows([
            row({ original_name: 'c', season: 1, episode: 10 }),
            row({ original_name: 'a', season: 1, episode: 2 }),
            row({ original_name: 'b', season: 1, episode: 9 }),
            row({ original_name: 'd', season: 2, episode: 1 })
        ]);
        // 9 before 10: the episode is compared as a number, not as text.
        expect(names(sorted)).toEqual(['a', 'b', 'c', 'd']);
    });

    it('reads a multi-episode range by its first episode', () => {
        const sorted = sortRows([
            row({ original_name: 'range', season: 1, episode: '10-12' }),
            row({ original_name: 'single', season: 1, episode: 9 })
        ]);
        expect(names(sorted)).toEqual(['single', 'range']);
    });

    it('ignores accents and case when comparing titles', () => {
        const sorted = sortRows([
            row({ original_name: 'b', clean_title: 'amelie' }),
            row({ original_name: 'a', clean_title: 'Amélie' })
        ]);
        // The two titles tie, so the on-disk name is what settles it — deterministically.
        expect(names(sorted)).toEqual(['a', 'b']);
    });

    it('sorts by year within a title', () => {
        const sorted = sortRows([
            row({ original_name: 'new', media_type: 'movie', clean_title: 'Dune', year: 2021 }),
            row({ original_name: 'old', media_type: 'movie', clean_title: 'Dune', year: 1984 })
        ]);
        expect(names(sorted)).toEqual(['old', 'new']);
    });

    it('puts a row with no year after the ones that have one', () => {
        const sorted = sortRows([
            row({ original_name: 'unknown', media_type: 'movie', clean_title: 'Dune' }),
            row({ original_name: 'known', media_type: 'movie', clean_title: 'Dune', year: 2021 })
        ]);
        expect(names(sorted)).toEqual(['known', 'unknown']);
    });

    it('is total, so the same input always comes out in the same order', () => {
        const rows = [row({ id: '2', original_name: 'same' }), row({ id: '1', original_name: 'same' })];
        expect(sortRows(rows).map((item) => item.id)).toEqual(['1', '2']);
        expect(sortRows([...rows].reverse()).map((item) => item.id)).toEqual(['1', '2']);
    });

    it('does not mutate the array it was given', () => {
        const rows = [row({ original_name: 'b', episode: 2 }), row({ original_name: 'a', episode: 1 })];
        sortRows(rows);
        expect(names(rows)).toEqual(['b', 'a']);
    });
});
