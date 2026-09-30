CREATE TABLE IF NOT EXISTS "CoupleLink" (
    "id" SERIAL NOT NULL,
    "inviteCode" TEXT,
    "inviteExpiresAt" TIMESTAMP(3),
    "anniversary" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CoupleLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CoupleLink_inviteCode_key" ON "CoupleLink"("inviteCode");

CREATE TABLE IF NOT EXISTS "CoupleMember" (
    "userId" INTEGER NOT NULL,
    "linkId" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CoupleMember_pkey" PRIMARY KEY ("userId")
);
CREATE INDEX IF NOT EXISTS "CoupleMember_linkId_idx" ON "CoupleMember"("linkId");

CREATE TABLE IF NOT EXISTS "CoupleScheduleSnapshot" (
    "userId" INTEGER NOT NULL,
    "semester" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CoupleScheduleSnapshot_pkey" PRIMARY KEY ("userId")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CoupleMember_userId_fkey') THEN
    ALTER TABLE "CoupleMember" ADD CONSTRAINT "CoupleMember_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CoupleMember_linkId_fkey') THEN
    ALTER TABLE "CoupleMember" ADD CONSTRAINT "CoupleMember_linkId_fkey"
      FOREIGN KEY ("linkId") REFERENCES "CoupleLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CoupleScheduleSnapshot_userId_fkey') THEN
    ALTER TABLE "CoupleScheduleSnapshot" ADD CONSTRAINT "CoupleScheduleSnapshot_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "CoupleMember"("userId") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
