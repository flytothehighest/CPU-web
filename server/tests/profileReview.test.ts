import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

process.env.REDIS_ENABLED = "false";
process.env.DATABASE_URL = "";

async function fixture(t: TestContext, patch: Record<string, unknown> = {}) {
  const { prisma } = await import("../src/prisma");
  const service = await import("../src/services/profileReview");
  const user: any = {
    id: 123, status: "active", nickname: "原昵称", bio: "原简介", avatar: null,
    updatedAt: new Date("2026-09-07T00:00:00Z"),
    profileReviewStatus: "checking", pendingProfile: JSON.stringify({ nickname: "新昵称", bio: "新简介" }),
    ...patch,
  };
  const replace = (target: any, key: string, value: any) => {
    const original = target[key];
    target[key] = value;
    t.after(() => { target[key] = original; });
  };
  const notifications: any[] = [];
  const resolutions: any[] = [];
  const assets: any[] = [];
  const writes: any[] = [];
  const matches = (where: any) => Object.entries(where).every(([key, value]: any) => {
    if (value instanceof Date) return user[key]?.getTime() === value.getTime();
    if (value?.in) return value.in.includes(user[key]);
    if (value?.notIn) return !value.notIn.includes(user[key]);
    return user[key] === value;
  });
  replace(prisma.user, "findUnique", async () => ({ ...user }));
  replace(prisma.user, "updateMany", async ({ where, data }: any) => {
    writes.push({ where, data });
    if (!matches(where)) return { count: 0 };
    Object.assign(user, data, { updatedAt: data.updatedAt || new Date(user.updatedAt.getTime() + 1) });
    return { count: 1 };
  });
  replace(prisma, "$transaction", async (work: any) => work(prisma));
  replace(prisma.notification, "create", async ({ data }: any) => { notifications.push(data); return data; });
  replace(prisma.notification, "createMany", async () => { assert.fail("must not broadcast staff review requests"); });
  replace(prisma.notification, "updateMany", async (args: any) => { resolutions.push(args); return { count: 1 }; });
  replace(prisma.forumImageAsset, "updateMany", async (args: any) => { assets.push(args); return { count: 1 }; });
  t.mock.method(console, "warn", () => {});
  const passed: any = { status: "auto_passed", reason: "正常资料", riskLevel: "low", riskScore: 0, detail: "", model: "test" };
  const reviewers = {
    text: async (_input: any) => passed,
    avatar: async (_url: string, _userId: number): Promise<any> => ({ approved: true, reason: "正常图片" }),
  };
  return { ...service, user, notifications, resolutions, assets, writes, reviewers };
}

test("profile submissions stay private, deduplicate retries and never broadcast manual review requests", async (t) => {
  const f = await fixture(t, { pendingProfile: null, profileReviewStatus: "none" });
  assert.equal(await f.submitProfileReview(123, { nickname: "新昵称", bio: "新简介" }), true);
  assert.equal(f.user.nickname, "原昵称");
  assert.equal(f.user.bio, "原简介");
  assert.equal(f.user.profileReviewStatus, "checking");
  const writes = f.writes.length;
  assert.equal(await f.submitProfileReview(123, { nickname: "新昵称", bio: "新简介" }), false);
  assert.equal(f.writes.length, writes);
  assert.equal(f.notifications.length, 0);
});

test("AI approval publishes the whole profile and resolves only its old manual requests", async (t) => {
  const f = await fixture(t);
  await f.processProfileReview({ ...f.user }, f.reviewers);
  assert.equal(f.user.nickname, "新昵称");
  assert.equal(f.user.bio, "新简介");
  assert.equal(f.user.pendingProfile, null);
  assert.equal(f.user.profileReviewStatus, "approved");
  assert.equal(f.notifications.length, 1);
  assert.equal(f.notifications[0].userId, 123);
  assert.equal(f.notifications[0].source, "AI 审核");
  assert.equal(f.resolutions[0].where.payload, JSON.stringify({ userId: 123 }));
  assert.equal(f.resolutions[0].where.title, "有用户资料等待审核");
});

test("legacy manual pending profiles also receive AI review", async (t) => {
  const f = await fixture(t, { profileReviewStatus: "pending" });
  await f.processProfileReview({ ...f.user }, f.reviewers);
  assert.equal(f.user.profileReviewStatus, "approved");
});

test("AI rejection keeps the previous public profile and informs only the submitting user", async (t) => {
  const f = await fixture(t);
  f.reviewers.text = async () => ({ status: "blocked_ai", reason: "广告导流" } as any);
  await f.processProfileReview({ ...f.user }, f.reviewers);
  assert.equal(f.user.nickname, "原昵称");
  assert.equal(f.user.bio, "原简介");
  assert.equal(f.user.profileReviewStatus, "rejected");
  assert.equal(f.notifications.length, 1);
  assert.equal(f.notifications[0].userId, 123);
  assert.equal(f.notifications[0].content, "广告导流");
});

test("a blocked avatar prevents even approved text from being published", async (t) => {
  const f = await fixture(t, { pendingProfile: JSON.stringify({ bio: "新简介", avatar: "/test-avatar.png" }) });
  f.reviewers.avatar = async () => ({ approved: false, reason: "图片不符合规则" });
  await f.processProfileReview({ ...f.user }, f.reviewers);
  assert.equal(f.user.bio, "原简介");
  assert.equal(f.user.avatar, null);
  assert.equal(f.user.profileReviewStatus, "rejected");
  assert.equal(f.assets[0].data.status, "rejected");
});

test("text and avatar must both pass before the profile and image become public", async (t) => {
  const f = await fixture(t, { pendingProfile: JSON.stringify({ bio: "新简介", avatar: "/test-avatar.png" }) });
  let checked = false;
  f.reviewers.avatar = async () => {
    assert.equal(f.user.bio, "原简介");
    assert.equal(f.user.avatar, null);
    checked = true;
    return { approved: true, reason: "正常头像" };
  };
  await f.processProfileReview({ ...f.user }, f.reviewers);
  assert.equal(checked, true);
  assert.equal(f.user.bio, "新简介");
  assert.equal(f.user.avatar, "/test-avatar.png");
  assert.equal(f.assets[0].data.status, "approved");
});

test("text and avatar outages retain the snapshot for automatic retry without staff notifications", async (t) => {
  const f = await fixture(t, { pendingProfile: JSON.stringify({ bio: "新简介", avatar: "/test-avatar.png" }) });
  for (const field of ["text", "avatar"] as const) {
    f.user.updatedAt = new Date("2026-09-07T00:00:00Z");
    const original = f.reviewers[field];
    f.reviewers[field] = async () => { throw new Error("timeout"); };
    const before = { ...f.user };
    await f.processProfileReview(before, f.reviewers);
    assert.equal(f.user.bio, "原简介");
    assert.equal(f.user.pendingProfile, before.pendingProfile);
    assert.equal(f.user.profileReviewStatus, "checking");
    assert.ok(f.user.updatedAt > before.updatedAt);
    assert.equal(f.notifications.length, 0);
    assert.equal(f.assets.length, 0);
    f.reviewers[field] = original;
  }
});

test("in-flight AI results cannot overwrite a newer submission, manual decision or deleting account", async (t) => {
  const f = await fixture(t);
  for (const patch of [
    { pendingProfile: JSON.stringify({ bio: "再次修改" }), updatedAt: new Date("2026-09-07T02:00:00Z") },
    { updatedAt: new Date("2026-09-07T03:00:00Z") },
    { profileReviewStatus: "rejected", pendingProfile: null },
    { status: "deleting" },
  ]) {
    Object.assign(f.user, { status: "active", profileReviewStatus: "checking", pendingProfile: JSON.stringify({ bio: "新简介" }) });
    const before = { ...f.user };
    f.reviewers.text = async () => { Object.assign(f.user, patch); return { status: "auto_passed", reason: "通过" } as any; };
    await f.processProfileReview(before, f.reviewers);
    assert.equal(f.user.bio, "原简介");
    for (const [key, value] of Object.entries(patch)) assert.deepEqual(f.user[key], value);
    assert.equal(f.notifications.length, 0);
  }
});
