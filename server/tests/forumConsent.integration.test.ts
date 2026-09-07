import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import { prisma } from "../src/prisma";
import { errorHandler } from "../src/middleware/error";
import { replyRouter } from "../src/routes/reply";
import { topicRouter } from "../src/routes/topic";
import { signToken } from "../src/utils/jwt";
import { setAiReviewConfig } from "../src/services/siteSettings";
import { recoverPendingForumSubmissions } from "../src/services/forumSubmissionReview";


test("AI review runs without consent metadata and recovers only consent-blocked submissions", { skip: process.env.PRIVACY_INTEGRATION_TEST !== "1" }, async () => {
  const database = new URL(process.env.DATABASE_URL!);
  assert.equal(database.hostname, "127.0.0.1");
  assert.equal(database.searchParams.get("schema"), "privacy_test");
  const suffix = randomUUID();
  const app = express();
  app.use(express.json());
  app.use("/api/replies", replyRouter);
  app.use("/api/topics", topicRouter);
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  let modelCalls = 0;
  const modelApp = express();
  modelApp.use(express.json());
  modelApp.post('/v1/chat/completions', (_req, res) => {
    modelCalls++;
    res.json({ choices: [{ message: { content: JSON.stringify({ risk_score: 0, risk_level: 'low', decision: 'auto_pass', reason: '通过', detail: 'test', categories: {} }) } }] });
  });
  const modelServer = modelApp.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => modelServer.once('listening', resolve));
  const modelUrl = 'http://127.0.0.1:' + (modelServer.address() as any).port + '/v1/chat/completions';
  let userId = 0;
  let boardId = 0;
  try {
    await setAiReviewConfig({ aiReviewEnabled: true, aiReviewApiUrl: modelUrl, aiReviewApiKey: "test-never-send", aiReviewModel: "test" });

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
      if (result.data?.submissionResult?.status === "published") break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(result.data.submissionResult.status, "published", JSON.stringify(result));
    assert.equal(result.data.hidden, false);
    const saved = await prisma.reply.findUniqueOrThrow({ where: { id: body.data.id } });
    assert.equal(saved.content, "Test reply");
    assert.doesNotMatch(saved.aiReviewDetail || "", /auto-manual-retry/);
    const repeated = await (await fetch(`${origin}/api/replies`, { method: "POST", headers, body: JSON.stringify({ topicId: topic.id, content: "Test reply", submissionId }) })).json() as any;
    assert.equal(repeated.data.id, saved.id);
    assert.equal(repeated.data.submissionResult.status, "published");
    const pendingTopic = await prisma.topic.create({ data: { boardId, authorId: userId, title: "Pending", content: "Pending", hidden: true, aiReviewStatus: "checking", submissionId: `topic-${suffix}` } });
    await prisma.topic.update({ where: { id: pendingTopic.id }, data: { aiReviewStatus: 'manual_requested', aiReviewDetail: 'AI consent unavailable; manual review required' } });
    const manual = await prisma.reply.create({ data: { topicId: topic.id, authorId: userId, content: 'Requested human review', hidden: true, aiReviewStatus: 'manual_requested', aiReviewDetail: 'User requested manual review' } });
    const held = await prisma.reply.create({ data: { topicId: topic.id, authorId: userId, content: 'Previously consent blocked', hidden: true, aiReviewStatus: 'manual_requested', aiReviewDetail: 'AI consent unavailable; manual review required' } });
    await recoverPendingForumSubmissions();
    for (let attempt = 0; attempt < 40; attempt++) {
      result = await (await fetch(`${origin}/api/topics/submissions/topic-${suffix}`, { headers })).json() as any;
      if (result.data?.submissionResult?.status === "published") break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(result.data.submissionResult.status, "published", JSON.stringify(result));
    assert.equal(result.data.hidden, false);
    for (let attempt = 0; attempt < 40; attempt++) {
      if (!(await prisma.reply.findUniqueOrThrow({ where: { id: held.id } })).hidden) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal((await prisma.reply.findUniqueOrThrow({ where: { id: held.id } })).aiReviewStatus, 'auto_passed');
    assert.equal((await prisma.reply.findUniqueOrThrow({ where: { id: manual.id } })).aiReviewStatus, 'manual_requested');
    assert.ok(modelCalls >= 3, 'the model must actually receive reply, topic and recovered reply reviews');
  } finally {
    await new Promise<void>((resolve) => modelServer.close(() => resolve()));
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
