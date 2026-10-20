import type { Entity, Storage } from '@ergon/core';
import type { SyncControl, SyncState } from './sync';

export const storageMethods = [
  'write',
  'todosBetween',
  'todoMarks',
  'reminders',
  'search',
  'listTodos',
  'recurrences',
  'seriesTodos',
  'lists',
  'listGroups',
  'settings',
] as const satisfies readonly (keyof Storage)[];

export const syncMethods = [
  'state',
  'info',
  'create',
  'join',
  'redeemLink',
  'phrase',
  'createLink',
  'devices',
  'revokeDevice',
  'signOut',
  'syncNow',
  'pushSetup',
  'putPush',
  'deletePush',
  'putReminders',
] as const satisfies readonly (keyof SyncControl)[];

export type StorageMethod = (typeof storageMethods)[number];
export type SyncMethod = (typeof syncMethods)[number];

export type Request = { id: number; args: unknown[] } & (
  { target: 'storage'; method: StorageMethod } | { target: 'sync'; method: SyncMethod }
);

/** Errors cross the worker boundary as plain data; `code` is an `ApiError` code. */
export interface WorkerError {
  name: string;
  message: string;
  code?: string;
}

export type Response =
  | { type: 'result'; id: number; result: unknown }
  | { type: 'error'; id: number; error: WorkerError }
  | { type: 'change'; entities: Entity[] }
  | { type: 'sync'; state: SyncState };
