import { describe, expect, it } from 'vitest';
import { MediaItem } from '../api';
import { cellText, columnIndex, COLUMNS, confidenceText, isEditableColumn, parseCell } from './columns';

/**
 * The row a `/api/scan` actually returns: pydantic emits an explicit `null` for every
 * field it has not filled in, so this — not a tidy object with the keys omitted — is
 * what the grid renders first.
 */
const scanned = (overrides: Partial<MediaItem> = {}): MediaItem =>
    ({
        id: '1',
        original_path: '/media/Doctor Who S05E02.mkv',
        original_name: 'Doctor Who S05E02.mkv',
        media_type: 'episode',
        clean_title: 'Doctor Who',
        year: null,
        season: 5,
        episode: 2,
        episode_title: null,
        proposed_name: null,
        tmdb_id: null,
        tvdb_id: null,
        status: 'pending',
        confidence: null,
        message: null,
        candidates: [],
        ...overrides,
    }) satisfies MediaItem;

describe('confidenceText', () => {
    // The regression: `item.confidence !== undefined` is true for a null, and the
    // `.toFixed(2)` that followed threw inside the render — which unmounted the tree
    // and left the user a black screen the moment they pressed Scan.
    it('prints nothing for a row that has not been analyzed', () => {
        expect(confidenceText(scanned())).toBeNull();
        expect(confidenceText(scanned({ confidence: undefined }))).toBeNull();
    });

    // Percent, and the same percent the threshold slider shows: a row at 50% and a
    // review threshold of 45% have to be comparable by eye, which `0.50` against `45%`
    // was not.
    it('prints a percentage for a scored row', () => {
        expect(confidenceText(scanned({ confidence: 1 }))).toBe('100%');
        expect(confidenceText(scanned({ confidence: 0.5 }))).toBe('50%');
        expect(confidenceText(scanned({ confidence: 0.455 }))).toBe('46%');
    });

    it('prints a zero score rather than hiding it', () => {
        expect(confidenceText(scanned({ confidence: 0 }))).toBe('0%');
    });
});

describe('cellText', () => {
    it('renders every column of a freshly scanned row without throwing', () => {
        for (const spec of COLUMNS) expect(typeof cellText(scanned(), spec.id)).toBe('string');
    });

    it('shows an unfilled field as empty, whether it is null or absent', () => {
        expect(cellText(scanned(), 'year')).toBe('');
        expect(cellText(scanned({ year: undefined }), 'year')).toBe('');
        expect(cellText(scanned(), 'proposed_name')).toBe('');
    });

    it('shows the values it does have', () => {
        expect(cellText(scanned(), 'season')).toBe('5');
        expect(cellText(scanned({ episode: '10-12' }), 'episode')).toBe('10-12');
        expect(cellText(scanned(), 'status')).toBe('pending');
    });
});

describe('the column model', () => {
    it('has a status column first, which is what makes the dot the row marker', () => {
        expect(COLUMNS[0].id).toBe('status');
        expect(columnIndex('status')).toBe(0);
    });

    it('never lets the status or the on-disk name be typed into', () => {
        expect(isEditableColumn(columnIndex('status'))).toBe(false);
        expect(isEditableColumn(columnIndex('original_name'))).toBe(false);
        expect(isEditableColumn(columnIndex('clean_title'))).toBe(true);
    });
});

describe('parseCell', () => {
    it('keeps a multi-episode range as text', () => {
        expect(parseCell('episode', '10-12')).toBe('10-12');
    });

    it('turns a plain number into a number', () => {
        expect(parseCell('year', '1980')).toBe(1980);
    });

    it('empties to undefined so the field is dropped rather than blanked', () => {
        expect(parseCell('year', '   ')).toBeUndefined();
    });
});
