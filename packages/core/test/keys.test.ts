import { ed25519 } from '@noble/curves/ed25519.js';
import { describe, expect, it } from 'vitest';
import {
  challengeMessage,
  deriveKeys,
  fromBase64,
  fromBase64Url,
  generateSeed,
  phraseToSeed,
  seal,
  seedToPhrase,
  signChallenge,
  toBase64,
  toBase64Url,
  unseal,
} from '../src';

describe('keys', () => {
  it('round-trips the seed through a 24-word phrase', () => {
    const seed = generateSeed();
    const phrase = seedToPhrase(seed);
    expect(phrase.split(' ')).toHaveLength(24);
    expect(phraseToSeed(`  ${phrase.toUpperCase().replaceAll(' ', '\n ')} `)).toEqual(seed);
  });

  it('rejects invalid phrases', () => {
    const words = seedToPhrase(generateSeed()).split(' ');
    expect(phraseToSeed(words.slice(0, 12).join(' '))).toBeUndefined();
    expect(phraseToSeed('not a phrase')).toBeUndefined();
  });

  it('derives stable, independent keys', () => {
    const seed = new Uint8Array(32).fill(7);
    const keys = deriveKeys(seed);
    expect(deriveKeys(seed.slice())).toEqual(keys);
    expect(keys.encryptionKey).not.toEqual(keys.secretKey);
    expect(fromBase64(keys.account)).toEqual(keys.publicKey);
    expect(keys.account).toMatchSnapshot();
  });

  it('signs challenges verifiably', () => {
    const keys = deriveKeys(generateSeed());
    const signature = signChallenge(keys, 'bm9uY2U=');
    expect(ed25519.verify(signature, challengeMessage('bm9uY2U='), keys.publicKey)).toBe(true);
    expect(ed25519.verify(signature, challengeMessage('b3RoZXI='), keys.publicKey)).toBe(false);
  });
});

describe('seal', () => {
  const key = new Uint8Array(32).fill(1);

  it('round-trips values', async () => {
    const value = { ops: [{ text: 'héllo 🍵'.repeat(1000) }] };
    const data = await seal(key, 'batch', value);
    expect(data).not.toContain('llo');
    expect(await unseal(key, 'batch', data)).toEqual(value);
  });

  it('rejects tampering, other keys and other kinds', async () => {
    const data = await seal(key, 'batch', { a: 1 });
    const bytes = fromBase64(data);
    bytes[bytes.length - 1]! ^= 1;
    await expect(unseal(key, 'batch', toBase64(bytes))).rejects.toThrow();
    await expect(unseal(new Uint8Array(32), 'batch', data)).rejects.toThrow();
    await expect(unseal(key, 'snapshot', data)).rejects.toThrow();
  });

  it('encodes URL-safe base64', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(toBase64Url(bytes)).toMatch(/^[\w-]+$/);
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
  });
});
