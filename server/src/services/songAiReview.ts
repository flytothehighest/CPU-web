import { getSiteConfig, resolveAiServiceCandidatesForScene } from "./siteSettings";
import { requestAiJson } from "./topicAiReview";
import { matchesSongIdentity, normalizeSongReviewResult, SONG_REVIEW_SYSTEM_PROMPT, songReviewPolicyVersion, type SongReviewInput, type SongReviewResult } from "./songReviewPolicy";

export function getSongReviewConfig() {
  const config = getSiteConfig();
  return { enabled: config.songReviewEnabled, policyVersion: songReviewPolicyVersion(config.songReviewRules), previousPolicyVersion: songReviewPolicyVersion(config.songReviewRules, "song-review-v1") };
}

async function publicJson(url: string, headers?: Record<string, string>) {
  const response = await fetch(url, { headers, redirect: "error", signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error("曲目信息暂不可用");
  // Fixed music-provider hosts only; no user supplied URLs or audio downloads.
  const reader = response.body?.getReader();
  if (!reader) throw new Error("曲目信息为空");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.length;
      if (bytes > 512_000) throw new Error("曲目信息过大");
      chunks.push(part.value);
    }
  } finally { await reader.cancel(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function getSongReviewEvidence(input: SongReviewInput) {
  const id = input.musicId || "";
  try {
    if (input.musicPlatform === "netease" && /^\d{1,20}$/.test(id)) {
      const [result, detail] = await Promise.all([
        publicJson(`https://music.163.com/api/song/lyric?id=${id}&lv=1&kv=1&tv=-1`),
        publicJson(`https://music.163.com/api/song/detail/?ids=${encodeURIComponent(`[${id}]`)}`)
      ]);
      const song = detail.songs?.find((s: any) => String(s.id) === id);
      const artist = song?.artists?.map((a: any) => a.name).join('/') || '';
      return { lyrics: String(result.lrc?.lyric || "").slice(0, 18000), description: "网易云对应曲目歌词", title: song?.name, artist, identityVerified: matchesSongIdentity(input, song?.name || '', artist) };
    }
    if (input.musicPlatform === "tencent" && /^[A-Za-z0-9]{1,32}$/.test(id)) {
      const key = /^\d+$/.test(id) ? "musicid" : "songmid";
      const result = await publicJson(`https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?${key}=${id}&format=json&nobase64=1`, { Referer: "https://y.qq.com/" });
      const lyrics = String(result.lyric || "").slice(0, 18000);
      const title = lyrics.match(/\[ti:([^\]]+)\]/i)?.[1] || '';
      const artist = lyrics.match(/\[ar:([^\]]+)\]/i)?.[1] || '';
      return { lyrics, description: "QQ音乐对应曲目歌词", title, artist, identityVerified: matchesSongIdentity(input, title, artist) };
    }
    if (input.musicPlatform === "bilibili" && /^BV[A-Za-z0-9]{10}$/.test(id)) {
      const result = await publicJson(`https://api.bilibili.com/x/web-interface/view?bvid=${id}`);
      return { lyrics: "", description: JSON.stringify({ title: result.data?.title, description: result.data?.desc }).slice(0, 6000), identityVerified: false };
    }
  } catch { /* Missing evidence must lead to uncertain review, not approval. */ }
  return { lyrics: "", description: "未取得该版本歌词或来源信息，AI暂无法确认", identityVerified: false };
}

export async function reviewSong(input: SongReviewInput): Promise<SongReviewResult & { policyVersion: string }> {
  const config = getSiteConfig();
  const policyVersion = songReviewPolicyVersion(config.songReviewRules);
  if (!config.songReviewEnabled) throw new Error("歌曲审核未启用");
  const evidence = await getSongReviewEvidence(input);
  try {
    const result = await requestAiJson([
      { role: "system", content: `${SONG_REVIEW_SYSTEM_PROMPT}\n管理员选曲规则：\n${config.songReviewRules}` },
      { role: "user", content: JSON.stringify({ ...input, evidence }) },
    ], {
      model: config.songReviewModel,
      fallbackModels: config.songReviewFallbackModels,
      providerConfigs: resolveAiServiceCandidatesForScene(config, "song-review"),
      webSearch: true,
      maxTokens: 1800,
      maxTransientRetries: 0,
      upstreamTimeoutMs: 45_000,
      signal: AbortSignal.timeout(65_000),
      logContext: { kind: "song-review", targetId: input.songId, targetLabel: `${input.title} / ${input.artist}` },
    });
    const decision = normalizeSongReviewResult(result.content, { model: result.model, hasLyrics: Boolean(evidence.lyrics), webSearchApplied: result.webSearchApplied, sources: result.webSearchSources });
    return { ...decision, policyVersion };
  } catch {
    return { status: "error", reason: "AI审核暂不可用或返回格式异常，将自动重试，也可重新发起AI审核", model: config.songReviewModel, sources: [], policyVersion };
  }
}
