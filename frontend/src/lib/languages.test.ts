import { describe, expect, it } from 'vitest';
import {
    isLanguageCode,
    languagesError,
    parseLanguages,
    promoteLanguage,
    removeLanguage,
    serializeLanguages
} from './languages';

/**
 * A bad language code is silent everywhere else: TMDB answers an unknown `language` with
 * untranslated results and TVDB 404s the translation and falls through. So the only
 * place it can be caught is here, and these tests are what keep it caught.
 */

describe('isLanguageCode', () => {
    it('accepts ISO 639-1, with an optional region', () => {
        expect(isLanguageCode('it')).toBe(true);
        expect(isLanguageCode('en')).toBe(true);
        expect(isLanguageCode('ja')).toBe(true);
        expect(isLanguageCode('pt-br')).toBe(true);
        expect(isLanguageCode('es-419')).toBe(true);
    });

    it('rejects anything that is not one', () => {
        expect(isLanguageCode('xx')).toBe(false);
        expect(isLanguageCode('itt')).toBe(false);
        expect(isLanguageCode('i')).toBe(false);
        expect(isLanguageCode('')).toBe(false);
        expect(isLanguageCode('it,en')).toBe(false);
        // Three-letter codes are TVDB's internal spelling, mapped in api_clients.py.
        // Typed in here they would reach TMDB, which does not know them.
        expect(isLanguageCode('ita')).toBe(false);
    });
});

describe('parseLanguages', () => {
    it('splits on commas and on whitespace, and lowercases', () => {
        expect(parseLanguages('IT, en')).toEqual(['it', 'en']);
        expect(parseLanguages('it en')).toEqual(['it', 'en']);
    });

    it('drops empties and repeats but keeps the order', () => {
        expect(parseLanguages(',,it,,en,it,')).toEqual(['it', 'en']);
        expect(parseLanguages('')).toEqual([]);
    });

    it('keeps a bad code rather than swallowing it', () => {
        // Dropping it here would look like the app accepted it.
        expect(parseLanguages('it,xx')).toEqual(['it', 'xx']);
    });
});

describe('promoteLanguage and removeLanguage', () => {
    it('moves a code to the front without disturbing the rest', () => {
        expect(promoteLanguage(['it', 'en', 'ja'], 'ja')).toEqual(['ja', 'it', 'en']);
        expect(promoteLanguage(['it', 'en'], 'it')).toEqual(['it', 'en']);
        expect(promoteLanguage(['it', 'en'], 'de')).toEqual(['it', 'en']);
    });

    it('removes one code and only that one', () => {
        expect(removeLanguage(['it', 'en'], 'it')).toEqual(['en']);
        expect(removeLanguage(['it', 'en'], 'de')).toEqual(['it', 'en']);
    });
});

describe('languagesError', () => {
    it('is null for a usable chain', () => {
        expect(languagesError(['it', 'en'])).toBeNull();
    });

    it('names every bad code', () => {
        expect(languagesError(['it', 'xx'])).toBe('xx non è un codice lingua');
        expect(languagesError(['xx', 'zz'])).toBe('xx, zz non sono codici lingua');
    });

    it('refuses an empty chain', () => {
        // `lang_prefs=` reaches the backend as one empty preference and every title
        // comes back in whatever the provider defaults to.
        expect(languagesError([])).toBe('Serve almeno una lingua');
    });
});

describe('serializeLanguages', () => {
    it('produces exactly what /api/analyze takes', () => {
        expect(serializeLanguages(['it', 'en'])).toBe('it,en');
    });
});
