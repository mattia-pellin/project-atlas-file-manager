import { AppConfig } from '../api';

/**
 * Everything the user is allowed to override, in one place.
 *
 * The backend defaults arrive from `GET /api/config`; anything the user changes is
 * kept locally and sent with each request. Nothing here is server state, so two
 * browser tabs cannot fight over a threshold.
 */

export interface Settings {
    directory: string;
    /** Comma-separated language pins, most preferred first. Validated in `lib/languages.ts`. */
    languages: string;
    /** At or above this a row is auto-selected for rename. */
    matchThreshold: number;
    /** Below this no name is proposed at all. */
    reviewThreshold: number;
    /** How many `/api/analyze` requests are allowed in flight at once. */
    analyzeConcurrency: number;
}

export const DEFAULT_SETTINGS: Settings = {
    directory: '/media',
    languages: 'it,en',
    matchThreshold: 0.75,
    reviewThreshold: 0.45,
    analyzeConcurrency: 10
};

/**
 * The pool is the *only* thing bounding the fan-out: the backend has no cap of its own
 * and `api_clients.py` opens a fresh `httpx.AsyncClient` per request, so this number is
 * simultaneously how fast a season pack fills in and how hard TMDB/TVDB get hit. The
 * ceiling is therefore a real limit rather than a widget convenience — past it the
 * providers start rate-limiting, which surfaces as rows failing for no visible reason.
 */
export const POOL_LIMITS = { min: 1, max: 100 } as const;

export const isPoolSize = (value: unknown): value is number =>
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= POOL_LIMITS.min &&
    value <= POOL_LIMITS.max;

const STORAGE_KEY = 'atlas_settings_v1';

/** The defaults the *server* reports, which beat the hard-coded ones above. */
export const settingsFromConfig = (config: AppConfig): Partial<Settings> => ({
    directory: config.default_directory || config.media_roots[0] || DEFAULT_SETTINGS.directory,
    languages: config.language_preference.join(','),
    matchThreshold: config.thresholds.match,
    reviewThreshold: config.thresholds.review
});

const isFraction = (value: unknown): value is number => typeof value === 'number' && value >= 0 && value <= 1;

/**
 * Reads stored settings, field by field.
 *
 * Anything missing, mistyped or out of range falls back to the default rather than
 * being trusted: a threshold of `"0.9"` or `null` from an older build would
 * otherwise reach the API and come back a 400 on every single row.
 */
export const loadSettings = (raw: string | null): Settings => {
    if (!raw) return { ...DEFAULT_SETTINGS };
    let stored: Record<string, unknown>;
    try {
        stored = JSON.parse(raw) as Record<string, unknown>;
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
    if (!stored || typeof stored !== 'object') return { ...DEFAULT_SETTINGS };

    const settings: Settings = {
        directory: typeof stored.directory === 'string' && stored.directory ? stored.directory : DEFAULT_SETTINGS.directory,
        languages: typeof stored.languages === 'string' && stored.languages ? stored.languages : DEFAULT_SETTINGS.languages,
        matchThreshold: isFraction(stored.matchThreshold) ? stored.matchThreshold : DEFAULT_SETTINGS.matchThreshold,
        reviewThreshold: isFraction(stored.reviewThreshold) ? stored.reviewThreshold : DEFAULT_SETTINGS.reviewThreshold,
        analyzeConcurrency: isPoolSize(stored.analyzeConcurrency)
            ? stored.analyzeConcurrency
            : DEFAULT_SETTINGS.analyzeConcurrency
    };

    // The backend rejects review > match with a 400. Correcting it here rather than
    // letting every row fail is the one place clamping is right: this value was never
    // shown to the user, it came out of storage. Equal is repaired too: the slider
    // cannot produce it, and it makes `review` a band no row can ever land in.
    if (settings.reviewThreshold >= settings.matchThreshold) {
        settings.reviewThreshold = DEFAULT_SETTINGS.reviewThreshold;
        settings.matchThreshold = DEFAULT_SETTINGS.matchThreshold;
    }
    return settings;
};

export const saveSettings = (settings: Settings, storage: Storage | undefined = globalThis.localStorage): void => {
    try {
        storage?.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
        // A full or disabled localStorage is not a reason to break the app.
    }
};

/**
 * Whether this browser has ever had settings saved.
 *
 * The distinction matters: with nothing stored, the server's defaults should win, but
 * once the user has chosen a threshold the server must not quietly take it back on
 * the next reload.
 */
export const hasStoredSettings = (storage: Storage | undefined = globalThis.localStorage): boolean => {
    try {
        return (storage?.getItem(STORAGE_KEY) ?? null) !== null;
    } catch {
        return false;
    }
};

export const readStoredSettings = (storage: Storage | undefined = globalThis.localStorage): Settings => {
    try {
        return loadSettings(storage?.getItem(STORAGE_KEY) ?? null);
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
};
