import { describe, it, expect } from 'vitest';
import { encodeBase62, decodeBase62 } from '../../src/services/base62';

describe('encodeBase62', () => {
  it('encodes 0 as "0"', () => {
    expect(encodeBase62(0n)).toBe('0');
  });

  it('matches known values', () => {
    // 1,000,000 = 4·62³ + 12·62² + 9·62 + 2 → "4c92"
    expect(encodeBase62(1_000_000n)).toBe('4c92');
    expect(encodeBase62(61n)).toBe('Z');
    expect(encodeBase62(62n)).toBe('10');
  });

  it('survives values beyond Number.MAX_SAFE_INTEGER (2^53)', () => {
    const n = 9007199254740993n; // 2^53 + 1 — a JS number would round this
    expect(decodeBase62(encodeBase62(n))).toBe(n);
  });

  it('throws on negative input', () => {
    expect(() => encodeBase62(-1n)).toThrow(RangeError);
  });
});

describe('decodeBase62', () => {
  it('throws on invalid characters and empty input', () => {
    expect(() => decodeBase62('ab!')).toThrow(RangeError);
    expect(() => decodeBase62('')).toThrow(RangeError);
  });
});

describe('round-trip property', () => {
  it('decode(encode(n)) === n for 1000 random BigInts', () => {
    for (let i = 0; i < 1000; i++) {
      const n = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));
      expect(decodeBase62(encodeBase62(n))).toBe(n);
    }
  });
});