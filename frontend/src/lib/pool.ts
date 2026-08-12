/**
 * Bounded parallelism.
 *
 * Analysis is one request per file and the previous UI fired all of them at once —
 * fine for eight fixtures, less fine for a season pack, and each one opens its own
 * client on the backend. The pool keeps the fan-out flat and, more usefully, reports
 * each result as it lands so rows fill in progressively instead of all at the end.
 */
export const runPool = async <T, R>(
    items: T[],
    limit: number,
    task: (item: T, index: number) => Promise<R>,
    onResult?: (result: R, item: T, index: number) => void
): Promise<R[]> => {
    const results = new Array<R>(items.length);
    let next = 0;

    const worker = async (): Promise<void> => {
        for (;;) {
            const index = next;
            next += 1;
            if (index >= items.length) return;
            const result = await task(items[index], index);
            results[index] = result;
            onResult?.(result, items[index], index);
        }
    };

    await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
    return results;
};
