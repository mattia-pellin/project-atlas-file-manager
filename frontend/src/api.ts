export interface CandidateOut {
    /** Stringified: TMDB ids are numbers and TVDB's are strings. Send it back as `forcedKey`. */
    key: string;
    label: string;
    source: 'tmdb' | 'tvdb';
    year?: number;
    score: number;
    title_score: number;
    year_factor: number;
    poster_url?: string;
    overview?: string;
    /** The candidate the proposed name was actually built from. */
    selected: boolean;
}

export interface MediaItem {
    id: string;
    original_path: string;
    original_name: string;
    media_type: string;
    clean_title: string;
    year?: number;
    season?: number;
    episode?: number | string;
    episode_title?: string;
    proposed_name?: string;
    tmdb_id?: number;
    tvdb_id?: number;
    // 'review' is a match the backend scored but does not trust. The name is
    // proposed and editable, but the row is deliberately not auto-selected.
    status: 'pending' | 'matched' | 'review' | 'renaming' | 'error' | 'success';
    confidence?: number;
    message?: string;
    /** Every candidate that was scored, best first. Empty until the row is analyzed. */
    candidates?: CandidateOut[];
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

/** The overrides the user may apply to a single analysis. */
export interface AnalyzeOptions {
    bypassCache: boolean;
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

export const clearCache = async (): Promise<{ cleared: number }> =>
    parse(await fetch('/api/cache', { method: 'DELETE' }), 'Could not clear the cache');

export const scanDirectory = async (directory: string, bypassCache: boolean, languages: string): Promise<MediaItem[]> => {
    const response = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directory, bypass_cache: bypassCache, language_preference: languages.split(',') })
    });
    return parse(response, 'Scan failed');
};

export const analyzeItem = async (item: MediaItem, options: AnalyzeOptions): Promise<MediaItem> => {
    const params = new URLSearchParams({
        bypass_cache: String(options.bypassCache),
        lang_prefs: options.languages
    });
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
