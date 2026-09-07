import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import { prisma } from "../src/prisma";
import { aiConsentGate, isAiContentWrite } from "../src/middleware/aiConsent";
import { errorHandler } from "../src/middleware/error";
import { replyRouter } from "../src/routes/reply";
import { topicRouter } from "../src/routes/topic";
import { signToken } from "../src/utils/jwt";
import { setAiReviewConfig } from "../src/services/siteSettings";
import { currentAiDisclosure } from "../src/services/aiConsent";
import { scheduleTopicSubmissionReview, consentManualReviewReason } from "../src/services/forumSubmissionReview";

test("ordinary forum writes do not require AI consent; explicit AI and private-message processing still do", () => {
  for (const path of ["/api/replies", "/api/replies/1", "/api/topics", "/api/topics/1", "/api/uploads/image"]) {
    assert.equal(isAiContentWrite("POST", path), false, path);
  }
  assert.equal(isAiContentWrite("POST", "/api/topics/smart-compose"), true);
  assert.equal(isAiContentWrite("POST", "/api/search/assistant"), true);
  assert.equal(isAiContentWrite("POST", "/api/direct-messages/1/messages"), true);
  assert.equal(consentManualReviewReason({ code: 4121 })?.includes("内容已保存"), true);
  assert.equal(consentManualReviewReason({ code: 4120 })?.includes("人工审核"), true);
  assert.equal(consentManualReviewReason(new Error("timeout")), null);
});

test("missing AI disclosure accepts an ordinary reply and returns manual review without retrying or publishing", { skip: process.env.PRIVACY_INTEGRATION_TEST !== "1" }, async () => {
  const database = new URL(process.env.DATABASE_URL!);
  assert.equal(database.hostname, "127.0.0.1");
  assert.equal(database.searchParams.get("schema"), "privacy_test");
  const suffix = randomUUID();
  const app = express();
  app.use(express.json());
  app.use("/api/replies", aiConsentGate, replyRouter);
  app.use("/api/topics", aiConsentGate, topicRouter);
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  let userId = 0;
  let boardId = 0;
  try {
    await setAiReviewConfig({ aiReviewEnabled: true, aiReviewApiUrl: "https://unconfigured.example/v1/chat/completions", aiReviewApiKey: "test-never-send", aiReviewModel: "test" });
    assert.equal(currentAiDisclosure().ready, false);
    const user = await prisma.user.create({ data: { username: `consent-${suffix}`, passwordHash: "test", nickname: "Test" } });
    userId = user.id;
    const board = await prisma.board.create({ data: { slug: suffix, name: "Test", type: "general" } });
    boardId = board.id;
    const topic = await prisma.topic.create({ data: { boardId, authorId: userId, title: "Test", content: "Test" } });
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${signToken({ userId, studentId: user.username, role: "user", campus: "" })}` };
    const submissionId = `reply-${suffix}`;
    const response = await fetch(`${origin}/api/replies`, { method: "POST", headers, body: JSON.stringify({ topicId: topic.id, content: "Test reply", submissionId }) });
    const body = await response.json() as any;
    assert.equal(response.status, 202, JSON.stringify(body));
    let result: any;
    for (let attempt = 0; attempt < 40; attempt++) {
      result = await (await fetch(`${origin}/api/replies/submissions/${submissionId}`, { headers })).json() as any;
      if (result.data?.submissionResult?.status === "manual_review") break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(result.data.submissionResult.status, "manual_review", JSON.stringify(result));
    assert.equal(result.data.hidden, true);
    const saved = await prisma.reply.findUniqueOrThrow({ where: { id: body.data.id } });
    assert.equal(saved.content, "Test reply");
    assert.doesNotMatch(saved.aiReviewDetail || "", /auto-manual-retry/);
    const repeated = await (await fetch(`${origin}/api/replies`, { method: "POST", headers, body: JSON.stringify({ topicId: topic.id, content: "Test reply", submissionId }) })).json() as any;
    assert.equal(repeated.data.id, saved.id);
    assert.equal(repeated.data.submissionResult.status, "manual_review");
    const pendingTopic = await prisma.topic.create({ data: { boardId, authorId: userId, title: "Pending", content: "Pending", hidden: true, aiReviewStatus: "checking", submissionId: `topic-${suffix}` } });
    scheduleTopicSubmissionReview(pendingTopic.id);
    for (let attempt = 0; attempt < 40; attempt++) {
      result = await (await fetch(`${origin}/api/topics/submissions/topic-${suffix}`, { headers })).json() as any;
      if (result.data?.submissionResult?.status === "manual_review") break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(result.data.submissionResult.status, "manual_review", JSON.stringify(result));
    assert.equal(result.data.hidden, true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (userId) {
      await prisma.notification.deleteMany({ where: { userId } });
      await prisma.reply.deleteMany({ where: { authorId: userId } });
      await prisma.topic.deleteMany({ where: { authorId: userId } });
      await prisma.user.delete({ where: { id: userId } });
    }
    if (boardId) await prisma.board.delete({ where: { id: boardId } });
    await prisma.$disconnect();
  }
});
