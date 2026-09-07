-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "aiConsentAgreedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "aiConsentVersion" TEXT,
ADD COLUMN IF NOT EXISTS "pendingProfile" TEXT,
ADD COLUMN IF NOT EXISTS "profileReviewReason" TEXT,
ADD COLUMN IF NOT EXISTS "profileReviewStatus" TEXT NOT NULL DEFAULT 'none';

-- CreateTable
CREATE TABLE IF NOT EXISTS "UserBlock" (
    "id" TEXT NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "targetId" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AccountDeletionJob" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "receiptHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "phase" TEXT NOT NULL DEFAULT 'data',
    "encryptedPayload" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountDeletionJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AccountRevokedCredential" (
    "tokenHash" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountRevokedCredential_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "UserBlock_targetId_idx" ON "UserBlock"("targetId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "UserBlock_ownerId_targetId_key" ON "UserBlock"("ownerId", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AccountDeletionJob_userId_key" ON "AccountDeletionJob"("userId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AccountDeletionJob_receiptHash_key" ON "AccountDeletionJob"("receiptHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AccountDeletionJob_status_nextAttemptAt_idx" ON "AccountDeletionJob"("status", "nextAttemptAt");

-- AddForeignKey
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserBlock_ownerId_fkey' AND conrelid = '"UserBlock"'::regclass) THEN ALTER TABLE "UserBlock" ADD CONSTRAINT "UserBlock_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $migration$;

-- AddForeignKey
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserBlock_targetId_fkey' AND conrelid = '"UserBlock"'::regclass) THEN ALTER TABLE "UserBlock" ADD CONSTRAINT "UserBlock_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $migration$;
