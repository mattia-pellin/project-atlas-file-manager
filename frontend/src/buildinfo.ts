import { version } from '../package.json';

/**
 * Which build of the app the browser is actually running.
 *
 * The point of this file is a question the user cannot otherwise answer: *is the tab in
 * front of me the code I just deployed?* A released version string does not settle it —
 * the container is rebuilt far more often than it is tagged, and a service worker or a
 * cached `index.html` can leave an old bundle running against a new backend.
 *
 * So there are two identifiers, and they answer different questions:
 *
 * - `VERSION` comes from `package.json`, which stays the only place it is written. It
 *   says which *release* this is, and it moves when a `v*` tag is cut.
 * - `BUILD` is a plain counter, incremented **by hand, in the same change that touches
 *   anything the browser downloads**. It says which *build* this is, and it moves far
 *   more often than the version does. Two builds of `1.0.0` are told apart by nothing
 *   else.
 *
 * The remaining two are stamped by the build itself and are absent from a dev server,
 * which is correct: `npm run dev` is not a build and has nothing to identify.
 */

/** Bumped on every change that reaches the browser. See the note above. */
export const BUILD = 5;

export const VERSION = version;

/** Short commit sha, passed in as `VITE_BUILD_SHA` by the image build. */
export const COMMIT: string = import.meta.env.VITE_BUILD_SHA ?? '';

/** ISO 8601, UTC, stamped by the image build as `VITE_BUILD_TIME`. */
export const BUILT_AT: string = import.meta.env.VITE_BUILD_TIME ?? '';

/** True under `npm run dev`, where the two stamps above are empty by design. */
export const IS_DEV: boolean = import.meta.env.DEV;

/**
 * The build time, in the reader's own locale, or `null` when there isn't one.
 *
 * Kept next to the value it formats and pure, so the overlay has no branching in it.
 */
export const formatBuiltAt = (iso: string): string | null => {
    if (!iso) return null;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' });
};
