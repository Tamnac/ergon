import type { Entity, Storage } from '@ergon/core';

export const methods = [
  'write',
  'todosBetween',
  'todoMarks',
  'listTodos',
  'recurrences',
  'seriesTodos',
  'lists',
  'listGroups',
  'settings',
] as const satisfies readonly (keyof Storage)[];

export type Method = (typeof methods)[number];

export interface Request {
  id: number;
  method: Method;
  args: unknown[];
}

export type Response =
  | { type: 'result'; id: number; result: unknown }
  | { type: 'error'; id: number; error: unknown }
  | { type: 'change'; entities: Entity[] };
