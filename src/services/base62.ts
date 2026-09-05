/**
 * Base62: numeric ID ↔ URL-safe code.
 * BigInt throughout — pg returns BIGINT as a string, and JS numbers silently
 * lose precision above Number.MAX_SAFE_INTEGER (2^53 - 1). The tests prove it.
 */
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const BASE = BigInt(ALPHABET.length); // 62n

export function encodeBase62(id: bigint): string {
  if (id < 0n) throw new RangeError(`ID must be non-negative, got ${id}`);
  if (id === 0n) return ALPHABET[0];

  let n = id;
  let code = '';
  while (n > 0n) {
    code = ALPHABET[Number(n % BASE)] + code;
    n /= BASE;
  }
  return code;
}

export function decodeBase62(code: string): bigint {
  if (code.length === 0) throw new RangeError('Cannot decode empty string');
  let n = 0n;
  for (const char of code) {
    const value = ALPHABET.indexOf(char);
    if (value === -1) throw new RangeError(`Invalid base62 character: "${char}"`);
    n = n * BASE + BigInt(value);
  }
  return n;
}