import { sha256 } from '@noble/hashes/sha2.js';
import type { Scheduled } from '../reminder';
import { SyncApi, type Fetch, type SealedReminder } from './api';
import { fromBase64, seal, toBase64, toBase64Url, utf8 } from './crypto';
import type { Credentials } from './engine';
import { deriveKeys } from './keys';

/** Plaintext of a sealed reminder, what the service worker shows. */
export interface ReminderPayload {
  id: string;
  text: string;
}

/** Opaque id of a scheduled reminder, so the server can tell reminders apart but not todos. */
const sealedId = ({ id, at }: Scheduled) => toBase64Url(sha256(utf8(`${id}@${at}`)).slice(0, 16));

/** Replaces the reminders the server pushes to this account's browsers. */
export async function uploadReminders(
  credentials: Credentials,
  reminders: readonly Scheduled[],
  fetch?: Fetch,
): Promise<void> {
  const key = deriveKeys(fromBase64(credentials.seed)).encryptionKey;
  const sealed = await Promise.all(
    reminders.map(async (reminder): Promise<SealedReminder> => ({
      id: sealedId(reminder),
      at: reminder.at,
      data: await seal(key, 'reminder', { id: reminder.id, text: reminder.text }),
    })),
  );
  await new SyncApi(credentials.server, credentials.token, fetch).putReminders(sealed);
}

/** The key the service worker unseals pushed reminders with (base64). */
export const reminderKey = (credentials: Credentials) =>
  toBase64(deriveKeys(fromBase64(credentials.seed)).encryptionKey);
