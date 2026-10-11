import { ed25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { entropyToMnemonic, mnemonicToEntropy, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { randomBytes, toBase64, utf8 } from './crypto';

const SEED_LENGTH = 32;

/** Everything derived from the master seed. */
export interface Keys {
  seed: Uint8Array;
  /** Encrypts batches and snapshots. */
  encryptionKey: Uint8Array;
  secretKey: Uint8Array;
  publicKey: Uint8Array;
  /** Base64 public key; identifies the account on any server. */
  account: string;
}

export function generateSeed(): Uint8Array {
  return randomBytes(SEED_LENGTH);
}

/** The seed as a 24-word BIP-39 recovery phrase. */
export function seedToPhrase(seed: Uint8Array): string {
  return entropyToMnemonic(seed, wordlist);
}

/** Tolerates case and extra whitespace; undefined if the phrase isn't a valid 24-word phrase. */
export function phraseToSeed(phrase: string): Uint8Array | undefined {
  const words = phrase.trim().toLowerCase().split(/\s+/).join(' ');
  if (!validateMnemonic(words, wordlist)) return undefined;
  const seed = mnemonicToEntropy(words, wordlist);
  return seed.length === SEED_LENGTH ? seed : undefined;
}

export function deriveKeys(seed: Uint8Array): Keys {
  const derive = (info: string) => hkdf(sha256, seed, undefined, utf8(info), 32);
  const secretKey = derive('ergon/v1/signing');
  const publicKey = ed25519.getPublicKey(secretKey);
  return {
    seed,
    encryptionKey: derive('ergon/v1/encryption'),
    secretKey,
    publicKey,
    account: toBase64(publicKey),
  };
}

/** Signature over a server challenge, proving ownership of the account key. */
export function signChallenge(keys: Keys, nonce: string): Uint8Array {
  return ed25519.sign(challengeMessage(nonce), keys.secretKey);
}

export function challengeMessage(nonce: string): Uint8Array {
  return utf8(`ergon-auth-v1:${nonce}`);
}
