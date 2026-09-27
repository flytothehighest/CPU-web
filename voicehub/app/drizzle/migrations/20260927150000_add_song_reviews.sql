CREATE TABLE IF NOT EXISTS "song_reviews" (
  "song_id" integer PRIMARY KEY REFERENCES "Song"("id") ON DELETE CASCADE,
  "status" text NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending','checking','approved','rejected','uncertain','error')),
  "fingerprint" text NOT NULL,
  "policy_version" text NOT NULL,
  "reason" text NOT NULL DEFAULT '等待审核',
  "model" text NOT NULL DEFAULT '',
  "sources" text NOT NULL DEFAULT '[]',
  "attempts" integer NOT NULL DEFAULT 0,
  "confirmed_at" timestamptz,
  "notified_at" timestamptz,
  "notification_key" text,
  "attempt_id" uuid,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
