import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { Errors } from "../utils/response";

type BlockStore = Pick<typeof prisma, "userBlock">;

export function blockPairWhere(firstId: number, secondId: number) {
  return { OR: [{ ownerId: firstId, targetId: secondId }, { ownerId: secondId, targetId: firstId }] };
}

export async function lockUserPair(tx: Prisma.TransactionClient, firstId: number, secondId: number) {
  const low = Math.min(firstId, secondId);
  const high = Math.max(firstId, secondId);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${low}::int, ${high}::int)`;
}

export async function hasUserBlock(firstId: number, secondId: number, store: BlockStore = prisma) {
  return Boolean(await store.userBlock.findFirst({ where: blockPairWhere(firstId, secondId), select: { id: true } }));
}

export async function ensureNoUserBlock(firstId: number, secondId: number, store: BlockStore = prisma) {
  if (await hasUserBlock(firstId, secondId, store)) throw Errors.forbidden("当前无法与此用户互动；可在账号与隐私中管理自己的屏蔽列表");
}

export function blockedAuthorWhere(viewer?: { blockedUserIds?: number[] } | null) {
  return viewer?.blockedUserIds?.length ? { authorId: { notIn: viewer.blockedUserIds } } : {};
}

export function isAuthorBlocked(authorId: number, viewer?: { blockedUserIds?: number[] } | null) {
  return Boolean(viewer?.blockedUserIds?.includes(authorId));
}
