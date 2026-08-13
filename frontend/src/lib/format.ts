/**
 * How a score is written, in the one place that decides it.
 *
 * Confidence is a 0–1 number everywhere inside the app, and was printed that way too —
 * `0.50` in the grid, `0.45` on the threshold thumbs, `50%` in triage. Three renderings
 * of one quantity, so a threshold read in the settings panel could not be compared by
 * eye with the number on the row it decided. It is a percentage now, everywhere.
 *
 * Rounded to whole points on purpose: the thumbs step by 0.01, and a decimal place would
 * only be exact enough to invite reading precision the scoring does not have.
 */
export const percent = (value: number): string => `${Math.round(value * 100)}%`;
