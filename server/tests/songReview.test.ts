import assert from "node:assert/strict";
import test from "node:test";
import { matchesSongIdentity, normalizeSongReviewResult, songReviewInputSchema, songReviewPolicyVersion } from "../src/services/songReviewPolicy";
import { isSongAdviceExpired, songAdviceDeadline, isSongReadyForScheduling, needsAutomaticSongReview, songReviewAdvice, songReviewFingerprint } from "../../voicehub/server/utils/song-review-policy";

const source = { title: "曲目来源", url: "https://music.example/song/1" };
const context = { model: "song-model", hasLyrics: true, webSearchApplied: true, sources: [source] };
const response = (patch = {}) => JSON.stringify({ decision: "approved", reason: "版本、歌词及来源已核对", category: "none", sufficient_evidence: true, source_urls: [source.url], ...patch });

test("已核实曲目没有具体问题时通过，不要求联网证明歌手没有争议", () => {
  assert.equal(normalizeSongReviewResult(response(), context).status, "approved");
  for (const patch of [{ webSearchApplied: false }, { sources: [] }]) {
    assert.equal(normalizeSongReviewResult(response(), { ...context, ...patch }).status, "approved");
  }
  assert.equal(normalizeSongReviewResult(response(), { ...context, hasLyrics: false }).status, "approved");
  assert.equal(normalizeSongReviewResult(response({ sufficient_evidence: false }), context).status, "approved");
});

test("Love U 2式的舆情资料不足不能触发确认，有确切重大风险才提示", () => {
  const noRumor = response({ decision: 'uncertain', category: 'artist', content_checks_passed: true, sufficient_evidence: false, source_urls: [], reason: '粤语歌词，未发现DJ或现场问题，但无法证明歌手没有争议' });
  const result = normalizeSongReviewResult(noRumor, { ...context, sources: [] });
  assert.equal(result.status, 'approved');
  assert.doesNotMatch(result.reason, /无法证明/);
  assert.equal(normalizeSongReviewResult(response({ decision: 'rejected', category: 'artist', content_checks_passed: true, sufficient_evidence: false }), context).status, 'approved');
  assert.equal(normalizeSongReviewResult(response({ decision: 'rejected', category: 'artist', content_checks_passed: true, major_artist_event: true }), context).status, 'rejected');
  assert.equal(normalizeSongReviewResult(noRumor, { ...context, hasLyrics: false }).status, 'approved');
});

test("伪造引用、矛盾决定、无证据指控不能转为自动结论", () => {
  const forged = normalizeSongReviewResult(response({ source_urls: ["https://invented.example/"] }), context);
  assert.equal(forged.status, "approved");
  assert.deepEqual(forged.sources, []);
  assert.throws(() => normalizeSongReviewResult(response({ category: "live" }), context));
  assert.equal(normalizeSongReviewResult(response({ decision: "rejected", category: "unknown" }), context).status, "approved");
  assert.equal(normalizeSongReviewResult(response({ decision: "rejected", category: "artist" }), { ...context, sources: [] }).status, "approved");
  assert.equal(normalizeSongReviewResult(response({ decision: "rejected", category: "live" }), context).status, "rejected");
});

test("非法JSON、缺失字段及旧人工批准动作均不被当成通过", () => {
  assert.throws(() => normalizeSongReviewResult("通过", context));
  assert.throws(() => normalizeSongReviewResult('{"decision":"approved"}', context));
  assert.throws(() => normalizeSongReviewResult(response({ decision: "approved_manual" }), context));
  assert.equal(normalizeSongReviewResult('```json\n' + response() + '\n```', context).status, "approved");
});

test("接口严格限制提交内容，不接受自带审核状态、歌词或任意URL平台", () => {
  const input = { songId: 1, title: "中文歌曲", artist: "歌手", musicPlatform: "netease", musicId: "123" };
  assert.equal(songReviewInputSchema.safeParse(input).success, true);
  for (const patch of [{ songId: -1 }, { status: "approved" }, { lyrics: "伪造歌词" }, { musicPlatform: "http://127.0.0.1/" }]) {
    assert.equal(songReviewInputSchema.safeParse({ ...input, ...patch }).success, false);
  }
});

test("排期只接受同一版本同一规则的通过结果", () => {
  const song = { title: "歌曲", artist: "歌手", musicPlatform: "netease", musicId: "123", playUrl: "" };
  const policyVersion = songReviewPolicyVersion("只支持中文录音室版本");
  const review = { status: "approved", fingerprint: songReviewFingerprint(song), policyVersion };
  assert.equal(isSongReadyForScheduling(song, review, policyVersion), true);
  assert.equal(isSongReadyForScheduling(song, undefined, policyVersion), false);
  for (const status of ["pending", "checking", "uncertain", "error", "rejected", "approved_manual"]) {
    assert.equal(isSongReadyForScheduling(song, { ...review, status }, policyVersion), false);
  }
  for (const patch of [{ title: "歌曲 (Live)" }, { artist: "其他歌手" }, { musicId: "456" }, { musicPlatform: "tencent" }, { playUrl: "https://other.example/song" }]) {
    assert.equal(isSongReadyForScheduling({ ...song, ...patch }, review, policyVersion), false);
  }
  assert.equal(isSongReadyForScheduling(song, review, songReviewPolicyVersion("修改后的规则")), false);
});

test("歌曲审核配置独立持久化、重新加载，服务和模型不覆盖文字审核", async t => {
  process.env.REDIS_ENABLED = "false";
  const { prisma } = await import("../src/prisma");
  const settings = await import("../src/services/siteSettings");
  const rows = new Map<string, string>();
  const replace = (target: any, key: string, value: any) => {
    const original = target[key]; target[key] = value; t.after(() => { target[key] = original; });
  };
  replace(prisma.user, "updateMany", async () => ({ count: 0 }));
  replace(prisma.siteSetting, "upsert", async ({ where, create, update }: any) => {
    const value = rows.has(where.key) ? update.value : create.value;
    rows.set(where.key, value);
    return { key: where.key, value };
  });
  replace(prisma, "$transaction", async (items: any) => Promise.all(items));
  replace(prisma.siteSetting, "findMany", async () => [...rows].map(([key, value]) => ({ key, value })));
  const textModel = settings.getSiteConfig().aiReviewModel;
  const saved = await settings.setAiReviewConfig({
    aiServices: [{ id: "text", name: "文字服务", provider: "ollama", apiUrl: "http://localhost:11434", apiKey: "" }, { id: "music", name: "歌曲服务", provider: "openai", apiUrl: "https://example.test/v1/responses", apiKey: "test-only" }],
    aiReviewServiceId: "text", songReviewServiceId: "music", songReviewEnabled: true, songReviewModel: "music-model", songReviewRules: "测试选曲规则", songReviewFallbackModels: "backup-model",
    aiServiceFallbacks: { ...settings.emptyAiServiceFallbacks(), "song-review": [{ serviceId: "text", model: "fallback-song" }] }
  });
  assert.equal(saved.songReviewServiceId, "music");
  assert.equal(saved.aiReviewServiceId, "text");
  assert.equal(saved.aiReviewModel, textModel);
  assert.equal(JSON.parse(rows.get("ai.songReview.config")!).rules, "测试选曲规则");
  await settings.loadFeatures();
  const loaded = settings.getSiteConfig();
  assert.equal(loaded.songReviewEnabled, true);
  assert.equal(loaded.songReviewModel, "music-model");
  assert.equal(loaded.songReviewFallbackModels, "backup-model");
  const candidates = settings.resolveAiServiceCandidatesForScene(loaded, "song-review");
  assert.deepEqual(candidates.map(c => c.serviceId), ["music", "text"]);
  assert.equal(candidates[1]?.model, "fallback-song");
  const disabled = await settings.setAiReviewConfig({ songReviewEnabled: false });
  assert.equal(disabled.songReviewModel, "music-model");
  assert.equal(disabled.aiReviewModel, textModel);
});

test("自动重试遵守退避和三次上限，不重复审核已终结结果，改源后重新排队", () => {
  const song = { title: '歌', artist: '演唱者' };
  const now = 1_000_000;
  const review = { status: 'error', fingerprint: songReviewFingerprint(song), policyVersion: 'v1', attempts: 1, updatedAt: new Date(now - 1000) };
  assert.equal(needsAutomaticSongReview(song, null, 'v1', now), true);
  assert.equal(needsAutomaticSongReview(song, review, 'v1', now), false);
  assert.equal(needsAutomaticSongReview(song, { ...review, updatedAt: new Date(now - 300_000) }, 'v1', now), true);
  assert.equal(needsAutomaticSongReview(song, { ...review, attempts: 3, updatedAt: new Date(0) }, 'v1', now), false);
  for (const status of ['approved', 'rejected']) assert.equal(needsAutomaticSongReview(song, { ...review, status, updatedAt: new Date(0) }, 'v1', now), false);
  assert.equal(needsAutomaticSongReview(song, { ...review, status: 'checking', updatedAt: new Date(now - 180_000) }, 'v1', now), true);
  assert.equal(needsAutomaticSongReview({ ...song, musicId: 'new' }, { ...review, attempts: 3 }, 'v1', now), true);
  assert.equal(needsAutomaticSongReview(song, { ...review, attempts: 3 }, 'v2', now), true);
});

test('选曲建议保留投稿，技术故障不冒充违规结论', () => {
  const warning = songReviewAdvice('rejected', '对应音源为现场版。');
  assert.equal(warning.message, '该投稿大概率不会被接受');
  assert.match(warning.detail, /24小时内未确认/);
  assert.match(songReviewAdvice('pending', '').message, /投稿已保存/);
  assert.match(songReviewAdvice('error', '').detail, /不代表你的投稿不符合要求/);
  assert.doesNotMatch(songReviewAdvice('error', '').message, /不会被接受/);
  assert.match(songReviewAdvice('approved', '').detail, /不代表一定/);
});

test('建议送达才计时，确认过的投稿永不因建议过期撤回', () => {
  const now = Date.parse('2026-09-27T00:00:00Z');
  assert.equal(songAdviceDeadline(null), null);
  assert.equal(songAdviceDeadline(new Date(now))?.getTime(), now + 86_400_000);
  const review = { status: 'rejected', notifiedAt: new Date(now), confirmedAt: null };
  assert.equal(isSongAdviceExpired(review, now + 86_400_000 - 1), false);
  assert.equal(isSongAdviceExpired(review, now + 86_400_000), true);
  assert.equal(isSongAdviceExpired({ ...review, notifiedAt: null }, now + 200_000_000), false);
  assert.equal(isSongAdviceExpired({ ...review, confirmedAt: new Date(now + 1000) }, now + 200_000_000), false);
  assert.equal(isSongAdviceExpired({ ...review, status: 'error' }, now + 200_000_000), false);
});

test('用户确认风险投稿后可进入排期，换歌或换规则后旧确认失效', () => {
  const song = { title: '歌曲', artist: '歌手', requesterId: 7 };
  const review = { status: 'rejected', fingerprint: songReviewFingerprint(song), policyVersion: 'v1', confirmedAt: new Date() };
  assert.equal(isSongReadyForScheduling(song, review, 'v1'), true);
  assert.equal(isSongReadyForScheduling(song, { ...review, confirmedAt: null }, 'v1'), false);
  assert.equal(isSongReadyForScheduling({ ...song, requesterId: 8 }, review, 'v1'), false);
  assert.equal(isSongReadyForScheduling({ ...song, title: '其他版本' }, review, 'v1'), false);
  assert.equal(isSongReadyForScheduling(song, review, 'v2'), false);
  assert.equal(needsAutomaticSongReview(song, { ...review, attempts: 1, updatedAt: new Date(0) }, 'v1'), false);
  assert.equal(needsAutomaticSongReview(song, { ...review, status: 'uncertain', confirmedAt: null, notifiedAt: new Date(), attempts: 1, updatedAt: new Date(0) }, 'v1'), false);
});

test('元数据必须对应真实音源，不能用其他歌手或删掉Live后缀冒充', () => {
  assert.equal(matchesSongIdentity({ title: '歌曲', artist: '歌手 A' }, '歌曲', '歌手A'), true);
  assert.equal(matchesSongIdentity({ title: '歌曲', artist: '歌手A' }, '歌曲 (Live)', '歌手A'), false);
  assert.equal(matchesSongIdentity({ title: '歌曲', artist: '歌手A' }, '歌曲', '歌手B'), false);
  assert.equal(matchesSongIdentity({ title: '歌曲', artist: '歌手A' }, '', ''), false);
});

test('歌词和身份资料仅从固定平台读取，任意URL ID不会被访问', async t => {
  const { getSongReviewEvidence } = await import('../src/services/songAiReview');
  const urls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: any) => {
    urls.push(String(url));
    return new Response(JSON.stringify(String(url).includes('/song/detail')
      ? { songs: [{ id: 123, name: '歌曲', artists: [{ name: '歌手' }] }] }
      : { lrc: { lyric: '[00:01]中文歌词' } }), { status: 200 });
  });
  const input = { songId: 1, title: '歌曲', artist: '歌手', musicPlatform: 'netease' as const, musicId: '123' };
  assert.equal((await getSongReviewEvidence(input)).identityVerified, true);
  assert.equal((await getSongReviewEvidence({ ...input, artist: '伪造歌手' })).identityVerified, false);
  const count = urls.length;
  assert.equal((await getSongReviewEvidence({ ...input, musicId: 'http://127.0.0.1/' })).identityVerified, false);
  assert.equal(urls.length, count);
  assert.ok(urls.every(url => new URL(url).hostname === 'music.163.com'));
});


test('名称格式、未核实音乐ID和资料不全不构成风险，明确歌词或现场问题仍给建议', () => {
  for (const reason of ['歌曲为中文且无明显问题，但QQ音乐ID未核验', '歌手艺名写法不同', '未取得源音频文件', '只有中文歌词和官方发行资料，舆情未知']) {
    assert.equal(normalizeSongReviewResult(response({decision: 'uncertain', category: 'unknown', sufficient_evidence: false, reason}), {...context, hasLyrics: false, sources: []}).status, 'approved');
  }
  assert.equal(normalizeSongReviewResult(response({ decision: 'rejected', category: 'lyrics', reason: '已提供的歌词有明确粗口' }), { ...context, webSearchApplied: false, sources: [] }).status, 'rejected');
  assert.equal(normalizeSongReviewResult(response({ decision: 'rejected', category: 'live' }), context).status, 'rejected');
});
