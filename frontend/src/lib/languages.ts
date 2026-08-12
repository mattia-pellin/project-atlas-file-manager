/**
 * Language codes, checked before they can reach the API.
 *
 * They used to be one comma-separated string typed into a box, which meant a typo was
 * indistinguishable from a preference: `en,itt` simply produced English titles, and the
 * only symptom was a library that had quietly stopped being Italian. Nothing downstream
 * can catch it — TMDB answers a bad `language` with untranslated results rather than an
 * error, and TVDB 404s the translation and falls through to the next code — so it has
 * to be caught here, while the user is still looking at what they typed.
 *
 * Stored as a comma-separated string all the same: that is what `/api/analyze` takes and
 * what older builds wrote to localStorage.
 */

/**
 * ISO 639-1. Both providers are keyed on it: TMDB takes `it-IT`, and `api_clients.py`
 * maps the two-letter code to TVDB's three-letter one.
 */
const ISO_639_1 = new Set(
    (
        'aa ab ae af ak am an ar as av ay az ba be bg bh bi bm bn bo br bs ca ce ch co cr cs cu cv cy ' +
        'da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu ' +
        'hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb ' +
        'lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om ' +
        'or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw ' +
        'ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu'
    ).split(' ')
);

/** `it`, or `pt-BR`. The region is optional and is passed through untouched. */
const SHAPE = /^([a-z]{2})(?:-([a-z]{2}|\d{3}))?$/;

export const isLanguageCode = (token: string): boolean => {
    const match = SHAPE.exec(token.trim().toLowerCase());
    return match !== null && ISO_639_1.has(match[1]);
};

/**
 * The language's own name, best effort.
 *
 * Decoration only — a chip reading `it` is already correct, and `Intl.DisplayNames`
 * depends on how much ICU data the browser shipped. Never used to decide validity:
 * a build with a trimmed ICU would then reject perfectly good codes.
 */
export const languageName = (token: string): string | null => {
    try {
        return new Intl.DisplayNames([token, 'en'], { type: 'language', fallback: 'none' }).of(token) ?? null;
    } catch {
        return null;
    }
};

/** Splits on commas *and* whitespace: pasting `it en` is the obvious thing to try. */
export const parseLanguages = (raw: string): string[] => {
    const seen = new Set<string>();
    const codes: string[] = [];
    for (const part of raw.split(/[\s,]+/)) {
        const token = part.trim().toLowerCase();
        if (!token || seen.has(token)) continue;
        seen.add(token);
        codes.push(token);
    }
    return codes;
};

export const serializeLanguages = (codes: string[]): string => codes.join(',');

/**
 * Moves a code to the front, which is the only reordering that matters: the list is a
 * fallback chain, so "which one wins" is the whole question and every other position is
 * a tie-break nobody thinks about.
 */
export const promoteLanguage = (codes: string[], code: string): string[] =>
    codes.includes(code) ? [code, ...codes.filter((other) => other !== code)] : codes;

export const removeLanguage = (codes: string[], code: string): string[] => codes.filter((other) => other !== code);

/**
 * Whether this list may be applied.
 *
 * An empty list is refused as firmly as a bad code: `lang_prefs=` reaches the backend as
 * one empty preference, and every title comes back in whatever the provider defaults to.
 */
export const languagesError = (codes: string[]): string | null => {
    const bad = codes.filter((code) => !isLanguageCode(code));
    if (bad.length > 0) return `${bad.join(', ')} ${bad.length === 1 ? 'is not a language code' : 'are not language codes'}`;
    if (codes.length === 0) return 'At least one language is needed';
    return null;
};
