import { describe, expect, it } from 'vitest';
import { percent } from './format';

describe('percent', () => {
    it('writes a 0–1 score as whole points', () => {
        expect(percent(0)).toBe('0%');
        expect(percent(0.45)).toBe('45%');
        expect(percent(1)).toBe('100%');
    });

    // 0.075 × 10 is 0.7500000000000001 in binary floating point, and the thresholds are
    // built by arithmetic like that. Rounding has to happen after the multiply, not by
    // trusting the number to already be a clean two decimals.
    it('rounds rather than truncating', () => {
        expect(percent(0.455)).toBe('46%');
        expect(percent(0.7500000000000001)).toBe('75%');
        expect(percent(1 / 3)).toBe('33%');
    });
});
