export interface MediaItem {
    id: string;
    original_path: string;
    original_name: string;
    media_type: string;
    clean_title: string;
    year?: number;
    season?: number;
    episode?: number;
    episode_title?: string;
    proposed_name?: string;
    tmdb_id?: number;
    tvdb_id?: number;
    status: 'pending' | 'renaming' | 'error' | 'success';
    message?: string;
}

export const scanDirectory = async (directory: string, bypassCache: boolean, languages: string): Promise<MediaItem[]> => {
    const response = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directory, bypass_cache: bypassCache, language_preference: languages.split(',') })
    });
    if (!response.ok) throw new Error('Failed to scan directory');
    return response.json();
};

export const analyzeItem = async (item: MediaItem, bypassCache: boolean, languages: string): Promise<MediaItem> => {
    const response = await fetch(`/api/analyze?bypass_cache=${bypassCache}&lang_prefs=${languages}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item)
    });
    if (!response.ok) throw new Error('Failed to analyze item');
    return response.json();
};

export const renameItems = async (items: MediaItem[]): Promise<MediaItem[]> => {
    const response = await fetch('/api/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items })
    });
    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`API Error: ${response.status} ${errorText}`);
    }
    return response.json();
};
