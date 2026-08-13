/// <reference types="vite/client" />

/**
 * The two stamps the image build passes in. Both are optional: a dev server sets
 * neither, and `buildinfo.ts` is the only reader, so the fallback lives there.
 */
interface ImportMetaEnv {
    /** Short commit sha, from the `GIT_SHA` build argument. */
    readonly VITE_BUILD_SHA?: string;
    /** ISO 8601, UTC, stamped when the bundle was built. */
    readonly VITE_BUILD_TIME?: string;
}
