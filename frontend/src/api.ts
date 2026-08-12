/**
 * Every optional field is `| null`, not just `?`.
 *
 * pydantic serialises `float | None = None` as an explicit `null`, so a field the
 * backend has not filled in arrives as `null` and never as `undefined`. Typing it as
 * `?: number` reads as safe and is not: `item.confidence !== undefined` passes on a
 * `null`, and the next `.toFixed(2)` throws inside a render, which unmounts the whole
 * tree and leaves a black screen. That was a real bug — the grid crashed on the first
 * scan, before anything had been analyzed. Keep the nulls in the type and let
 * `strict` find the unsafe reads.
 */
export interface CandidateOut {
    /** Stringified: TMDB ids are numbers and TVDB's are strings. Send it back as `forcedKey`. */
    key: string;
    label: string;
    source: 'tmdb' | 'tvdb';
    year?: number | null;
    score: number;
    title_score: number;
    year_factor: number;
    poster_url?: string | null;
    overview?: string | null;
    /** The candidate the proposed name was actually built from. */
    selected: boolean;
}

export interface MediaItem {
    id: string;
    original_path: string;
    original_name: string;
    media_type: string;
    clean_title: string;
    year?: number | null;
    season?: number | null;
    episode?: number | string | null;
    episode_title?: string | null;
    proposed_name?: string | null;
    tmdb_id?: number | null;
    tvdb_id?: number | null;
    // 'review' is a match the backend scored but does not trust. The name is
    // proposed and editable, but the row is deliberately not auto-selected.
    status: 'pending' | 'matched' | 'review' | 'renaming' | 'error' | 'success';
    confidence?: number | null;
    message?: string | null;
    /** Every candidate that was scored, best first. Empty until the row is analyzed. */
    candidates?: CandidateOut[] | null;
}

export interface AppConfig {
    media_roots: string[];
    default_directory?: string;
    language_preference: string[];
    cache_ttl_hours: number;
    cache_entries: number;
    cache_size_bytes: number;
    thresholds: { match: number; review: number; decisive_margin: number };
    max_candidates: number;
    tmdb_configured: boolean;
    tvdb_configured: boolean;
}

/**
 * The result of *using* a key, which is a different question from `tmdb_configured`.
 *
 * Four states because three of them used to arrive as the same "Could not find a match":
 * a key that is missing, one the provider rejected and a provider that never answered
 * call for three different things to do.
 */
export interface KeyStatus {
    state: 'ok' | 'invalid' | 'missing' | 'unreachable';
    detail: string;
}

export interface KeyCheck {
    tmdb: KeyStatus;
    tvdb: KeyStatus;
}

/** The overrides the user may apply to a single analysis. */
export interface AnalyzeOptions {
    languages: string;
    /** A candidate picked by hand in triage. Settles the match instead of the scoring. */
    forcedKey?: string;
    matchThreshold?: number;
    reviewThreshold?: number;
}

const parse = async <T>(response: Response, what: string): Promise<T> => {
    if (!response.ok) {
        // The backend puts the real reason in `detail` — an out-of-root directory, an
        // impossible threshold. Surfacing "failed" instead sends the user looking in
        // the wrong place.
        const body = await response.json().catch(() => null);
        const detail = body && typeof body.detail === 'string' ? body.detail : String(response.status);
        throw new Error(`${what}: ${detail}`);
    }
    return response.json() as Promise<T>;
};

export const getConfig = async (): Promise<AppConfig> =>
    parse(await fetch('/api/config'), 'Could not read the configuration');

/** Deliberately uncached and never called on a schedule: it spends one request per provider. */
export const checkKeys = async (): Promise<KeyCheck> => parse(await fetch('/api/keys'), 'Could not check the keys');

export const clearCache = async (): Promise<{ cleared: number }> =>
    parse(await fetch('/api/cache', { method: 'DELETE' }), 'Could not clear the cache');

export const scanDirectory = async (directory: string, languages: string): Promise<MediaItem[]> => {
    const response = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directory, language_preference: languages.split(',') })
    });
    return parse(response, 'Scan failed');
};

export const analyzeItem = async (item: MediaItem, options: AnalyzeOptions): Promise<MediaItem> => {
    // The cache is never bypassed per request. It holds raw provider payloads and
    // nothing derived, so "ask again" is emptying it once — a switch would have made
    // every future scan pay for one stale answer.
    const params = new URLSearchParams({ lang_prefs: options.languages });
    if (options.forcedKey) params.set('forced_key', options.forcedKey);
    if (options.matchThreshold !== undefined) params.set('match_threshold', String(options.matchThreshold));
    if (options.reviewThreshold !== undefined) params.set('review_threshold', String(options.reviewThreshold));

    const response = await fetch(`/api/analyze?${params}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The candidate list is dropped on the way out: the server rebuilds it every
        // time, and it is by far the bulkiest part of a row.
        body: JSON.stringify({ ...item, candidates: [] })
    });
    return parse(response, 'Analysis failed');
};

export const renameItems = async (items: MediaItem[]): Promise<MediaItem[]> => {
    const response = await fetch('/api/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: items.map((item) => ({ ...item, candidates: [] })) })
    });
    return parse(response, 'Rename failed');
};
