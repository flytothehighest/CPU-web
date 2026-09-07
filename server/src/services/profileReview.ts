import { z } from "zod";
import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import { normalizeNicknameSubmission } from "./nicknameReview";
import { deleteManagedUserAvatar, storeUserAvatarDataUrl } from "./userAvatarStorage";
import { invalidateForumCaches } from "./cacheInvalidation";

export const profileSubmissionSchema = z.object({
  nickname: z.string().optional(),
  avatar: z.string().max(8 * 1024 * 1024).nullable().optional(),
  bio: z.string().trim().max(500).nullable().optional(),
  college: z.string().trim().max(80).nullable().optional(),
  enrollYear: z.number().int().min(1900).max(2100).nullable().optional(),
});

export async function submitProfileReview(userId: number, raw: Record<string, unknown>) {
  const parsed = profileSubmissionSchema.safeParse(raw);
  if (!parsed.success) throw Errors.badRequest(parsed.error.issues[0]?.message || "资料格式不正确");
  if (!Object.keys(parsed.data).length) return false;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || ["deleting", "deleted"].includes(user.status)) throw Errors.unauthorized();
  const pending = user.pendingProfile ? JSON.parse(user.pendingProfile) : {};
  const update = { ...pending, ...parsed.data };
  if (parsed.data.nickname !== undefined) update.nickname = normalizeNicknameSubmission(parsed.data.nickname);
  if (parsed.data.avatar) {
    if (parsed.data.avatar.startsWith("data:image/")) update.avatar = await storeUserAvatarDataUrl(userId, parsed.data.avatar, true);
    else if (parsed.data.avatar !== user.avatar && parsed.data.avatar !== pending.avatar) throw Errors.badRequest("请上传新的头像图片，不能直接提交外部图片地址");
  }
  const changed = Object.entries(update).some(([key, value]) => (user as any)[key] !== value);
  if (!changed) return false;
  const snapshot = JSON.stringify(update);
  const result = await prisma.user.updateMany({ where: { id: userId, status: { notIn: ["deleting", "deleted"] }, updatedAt: user.updatedAt }, data: {
    pendingProfile: snapshot, profileReviewStatus: "pending", profileReviewReason: "资料已提交人工审核，审核通过后公开显示",
    ...(update.nickname !== undefined ? { pendingNickname: update.nickname, nicknameReviewStatus: "manual_pending", nicknameReviewReason: "昵称已提交人工审核", nicknameReviewRequestedAt: new Date() } : {}),
  } });
  if (!result.count) throw Errors.conflict("资料已发生变化，请刷新后重新提交");
  if (pending.avatar && pending.avatar !== update.avatar && pending.avatar !== user.avatar) await deleteManagedUserAvatar(pending.avatar).catch(() => false);
  const staff = await prisma.user.findMany({ where: { role: { in: ["admin", "mod"] }, status: "active" }, select: { id: true } });
  if (staff.length) await prisma.notification.createMany({ data: staff.map(({ id }) => ({ userId: id, category: "profile-review", title: "有用户资料等待审核", content: "请检查昵称、头像和简介是否符合社区规则。", link: "/admin?tab=forum-reports", source: "资料审核", payload: JSON.stringify({ userId }) })) });
  return true;
}

export async function decideProfileReview(userId: number, reviewerId: number, snapshot: string, approve: boolean, note: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.profileReviewStatus !== "pending" || user.pendingProfile !== snapshot || ["deleting", "deleted"].includes(user.status)) throw Errors.conflict("资料已变更，请重新读取审核队列");
  const data = profileSubmissionSchema.parse(JSON.parse(snapshot));
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.updateMany({ where: { id: userId, pendingProfile: snapshot, profileReviewStatus: "pending", status: { notIn: ["deleting", "deleted"] } }, data: {
      ...(approve ? data : {}), pendingProfile: null, profileReviewStatus: approve ? "approved" : "rejected", profileReviewReason: note || (approve ? "资料审核通过" : "资料未通过审核，请按社区规则修改后重试"),
      ...(data.nickname !== undefined ? { pendingNickname: null, nicknameReviewStatus: approve ? "approved" : "rejected", nicknameReviewReason: note, nicknameReviewedAt: new Date() } : {}),
    } });
    if (!updated.count) throw Errors.conflict("该资料已被处理");
    if (data.avatar) await tx.forumImageAsset.updateMany({ where: { url: data.avatar, createdById: userId, status: "manual_profile_pending" }, data: { status: approve ? "approved" : "rejected", manualReviewedById: reviewerId, manualReviewedAt: new Date(), manualReviewNote: note, reviewModel: "manual-profile" } });
    await tx.notification.create({ data: { userId, category: "profile-review", title: approve ? "资料已通过审核" : "资料未通过审核", content: note || (approve ? "你的资料已公开生效。" : "请修改资料后重新提交。"), link: "/profile", source: "人工审核", payload: JSON.stringify({ reviewerId, approved: approve }) } });
    return updated;
  });
  if (data.avatar && ((approve && user.avatar !== data.avatar) || (!approve && data.avatar !== user.avatar))) {
    await deleteManagedUserAvatar(approve ? user.avatar : data.avatar).catch(() => false);
  }
  await invalidateForumCaches();
  return result;
}
