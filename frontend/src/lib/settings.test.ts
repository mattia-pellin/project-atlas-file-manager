import { describe, expect, it } from 'vitest';
import { AppConfig } from '../api';
import { DEFAULT_SETTINGS, loadSettings, settingsFromConfig } from './settings';

/**
 * Stored settings are untrusted input: they were written by an older build, possibly
 * by hand. A bad threshold here reaches `/api/analyze` and comes back a 400 on every
 * row, which presents as "the app is broken" rather than "this value is wrong".
 */

describe('loadSettings', () => {
    it('falls back completely when there is nothing, or nothing parseable', () => {
        expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
        expect(loadSettings('{oh no')).toEqual(DEFAULT_SETTINGS);
        expect(loadSettings('null')).toEqual(DEFAULT_SETTINGS);
    });

    it('keeps the good fields and replaces only the bad ones', () => {
        const loaded = loadSettings(JSON.stringify({ directory: '/media/tv', matchThreshold: 'high', languages: 'de,en' }));
        expect(loaded.directory).toBe('/media/tv');
        expect(loaded.languages).toBe('de,en');
        expect(loaded.matchThreshold).toBe(DEFAULT_SETTINGS.matchThreshold);
    });

    it('rejects a threshold outside 0–1', () => {
        expect(loadSettings(JSON.stringify({ matchThreshold: 42 })).matchThreshold).toBe(DEFAULT_SETTINGS.matchThreshold);
        expect(loadSettings(JSON.stringify({ reviewThreshold: -1 })).reviewThreshold).toBe(DEFAULT_SETTINGS.reviewThreshold);
    });

    it('resets both thresholds when review sits above match', () => {
        // The backend refuses this pair outright, so a stored one has to be repaired
        // before it is ever sent.
        const loaded = loadSettings(JSON.stringify({ matchThreshold: 0.3, reviewThreshold: 0.9 }));
        expect(loaded.matchThreshold).toBe(DEFAULT_SETTINGS.matchThreshold);
        expect(loaded.reviewThreshold).toBe(DEFAULT_SETTINGS.reviewThreshold);
    });
});

describe('settingsFromConfig', () => {
    const config: AppConfig = {
        media_roots: ['/media'],
        default_directory: '/media/incoming',
        language_preference: ['it', 'en'],
        cache_ttl_hours: 168,
        cache_entries: 12,
        cache_size_bytes: 4096,
        thresholds: { match: 0.8, review: 0.5, decisive_margin: 0.08 },
        max_candidates: 5,
        tmdb_configured: true,
        tvdb_configured: true
    };

    it('takes the defaults the server reports, thresholds included', () => {
        expect(settingsFromConfig(config)).toEqual({
            directory: '/media/incoming',
            languages: 'it,en',
            matchThreshold: 0.8,
            reviewThreshold: 0.5
        });
    });

    it('falls back to the first root when no directory is configured', () => {
        expect(settingsFromConfig({ ...config, default_directory: undefined }).directory).toBe('/media');
    });
});
