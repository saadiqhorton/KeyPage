import type Database from "better-sqlite3";

import type { ActivityEventAction } from "@keypage/shared";

import { newId } from "../auth/tokens.js";

export type RecordActivityEventInput = {
  keyEntryId: string;
  action: ActivityEventAction;
  occurredAt: string;
};

export function recordActivityEvent(
  db: Database.Database,
  input: RecordActivityEventInput,
): void {
  db.prepare(
    `INSERT INTO activity_events (id, key_entry_id, action, occurred_at)
     VALUES (?, ?, ?, ?)`,
  ).run(newId(), input.keyEntryId, input.action, input.occurredAt);
}
