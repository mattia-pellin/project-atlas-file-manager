import { describe, expect, it } from 'vitest';
import { MediaItem } from '../api';
import { isEpisodeValid, isRowValid, isSeasonValid, isYearValid } from './validation';

const row = (overrides: Partial<MediaItem> = {}): MediaItem => ({
    id: '1',
    original_path: '/media/Show.S01E01.mkv',
    original_name: 'Show.S01E01.mkv',
    media_type: 'episode',
    clean_title: 'Show',
    season: 1,
    episode: 1,
    proposed_name: 'Show - S01E01.mkv',
    status: 'matched',
    ...overrides,
});

describe('isSeasonValid', () => {
    it('accepts empty values, since season is optional', () => {
        expect(isSeasonValid(undefined)).toBe(true);
        expect(isSeasonValid(null)).toBe(true);
        expect(isSeasonValid('')).toBe(true);
    });

    it('accepts season 0 for specials', () => {
        expect(isSeasonValid(0)).toBe(true);
    });

    it.each([1, 99])('accepts %s', (v) => expect(isSeasonValid(v)).toBe(true));
    it.each([-1, 100, 1.5, 'abc'])('rejects %s', (v) => expect(isSeasonValid(v)).toBe(false));
});

describe('isEpisodeValid', () => {
    it('rejects empty values, since episode is mandatory for a series', () => {
        expect(isEpisodeValid(undefined)).toBe(false);
        expect(isEpisodeValid(null)).toBe(false);
        expect(isEpisodeValid('')).toBe(false);
    });

    it.each([1, 9999, '1', '0012'])('accepts %s', (v) => expect(isEpisodeValid(v)).toBe(true));
    it.each([0, 10000, 'abc', '1-'])('rejects %s', (v) => expect(isEpisodeValid(v)).toBe(false));

    it('accepts a multi-episode range', () => {
        expect(isEpisodeValid('10-12')).toBe(true);
    });

    it('rejects a range that does not ascend', () => {
        expect(isEpisodeValid('12-10')).toBe(false);
        // Regression guard: parser.py emits "N-N" for a single-element episode
        // list, which this predicate rejects. See CLAUDE.md, "known defects".
        expect(isEpisodeValid('5-5')).toBe(false);
    });
});

describe('isYearValid', () => {
    it('accepts empty values, since year is optional', () => {
        expect(isYearValid(undefined)).toBe(true);
        expect(isYearValid('')).toBe(true);
    });

    it.each([1900, 2026, 2100])('accepts %s', (v) => expect(isYearValid(v)).toBe(true));
    it.each([1899, 2101, 'abc'])('rejects %s', (v) => expect(isYearValid(v)).toBe(false));
});

describe('isRowValid', () => {
    it('accepts a well-formed episode row', () => {
        expect(isRowValid(row())).toBe(true);
    });

    it('accepts a well-formed movie row and ignores season/episode', () => {
        expect(isRowValid(row({ media_type: 'movie', season: undefined, episode: undefined }))).toBe(true);
    });

    it('rejects a row whose proposed name equals the original: nothing to do', () => {
        expect(isRowValid(row({ proposed_name: 'Show.S01E01.mkv' }))).toBe(false);
    });

    it('rejects an unresolved media type', () => {
        expect(isRowValid(row({ media_type: 'unknown' }))).toBe(false);
    });

    it('rejects an episode row with no episode number', () => {
        expect(isRowValid(row({ episode: undefined }))).toBe(false);
    });

    it('rejects an out-of-range year', () => {
        expect(isRowValid(row({ year: 1800 }))).toBe(false);
    });
});
