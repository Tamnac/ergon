import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';

/** What sealed data is for; bound to the ciphertext so one can't pass for another. */
export type SealKind = 'batch' | 'snapshot' | 'link';

const VERSION = 1;
const NONCE_LENGTH = 24;

/** Encrypts the gzipped JSON of `value`: `version ‖ nonce ‖ ciphertext`, as base64. */
export async function seal(key: Uint8Array, kind: SealKind, value: unknown): Promise<string> {
  const nonce = randomBytes(NONCE_LENGTH);
  const plain = await compress(utf8(JSON.stringify(value)), new CompressionStream('gzip'));
  const cipher = xchacha20poly1305(key, nonce, utf8(`ergon/v1/${kind}`)).encrypt(plain);
  const out = new Uint8Array(1 + NONCE_LENGTH + cipher.length);
  out[0] = VERSION;
  out.set(nonce, 1);
  out.set(cipher, 1 + NONCE_LENGTH);
  return toBase64(out);
}

/** Reverses `seal`; throws if the data was tampered with or sealed with another key or kind. */
export async function unseal<T>(key: Uint8Array, kind: SealKind, data: string): Promise<T> {
  const bytes = fromBase64(data);
  if (bytes[0] !== VERSION) throw new Error(`Unsupported sealed data version ${bytes[0]}`);
  const nonce = bytes.subarray(1, 1 + NONCE_LENGTH);
  const cipher = bytes.subarray(1 + NONCE_LENGTH);
  const plain = xchacha20poly1305(key, nonce, utf8(`ergon/v1/${kind}`)).decrypt(cipher);
  return JSON.parse(
    new TextDecoder().decode(await compress(plain, new DecompressionStream('gzip'))),
  );
}

async function compress(
  bytes: Uint8Array,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const body = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(body).arrayBuffer());
}

export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** URL-safe base64 without padding, for ids and keys in URLs. */
export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array {
  const base64 = text.replaceAll('-', '+').replaceAll('_', '/');
  return fromBase64(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
}
