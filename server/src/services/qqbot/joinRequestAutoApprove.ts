// 加群申请自动通过：群设置了入群问题时，QQ 会把申请人的回答放进 comment（"问题：…\n答案：…"）。
// 只比对答案部分，避免问题本身含有关键词导致任何人都被放行；比对前统一全半角、大小写并去掉空白和标点，
// 较长的关键词再容许少量错别字，未命中则继续走人工审核。

export const MAX_JOIN_AUTO_APPROVE_KEYWORDS = 50;
const MAX_KEYWORD_LENGTH = 40;

export function normalizeJoinAutoApproveKeywords(input: unknown): string[] {
  const items = Array.isArray(input) ? input : [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const keyword = String(item ?? "").trim().slice(0, MAX_KEYWORD_LENGTH);
    const key = normalizeJoinAnswerText(keyword);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(keyword);
    if (result.length >= MAX_JOIN_AUTO_APPROVE_KEYWORDS) break;
  }
  return result;
}

export function extractJoinRequestAnswer(comment: string | null | undefined) {
  const text = String(comment || "").trim();
  if (!text) return "";
  // 取最后一个“答案：”之后的内容：问题由群主设置，答案在其后。
  const matches = [...text.matchAll(/(?:^|\n)\s*答案\s*[:：]/g)];
  if (!matches.length) return text;
  const last = matches[matches.length - 1];
  return text.slice((last.index ?? 0) + last[0].length).trim();
}

export function normalizeJoinAnswerText(value: string) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

export function matchJoinAutoApproveKeyword(comment: string | null | undefined, keywords: string[]): string | null {
  const answer = normalizeJoinAnswerText(extractJoinRequestAnswer(comment));
  if (!answer) return null;
  for (const keyword of keywords) {
    const target = normalizeJoinAnswerText(keyword);
    if (target && answer.includes(target)) return keyword;
  }
  for (const keyword of keywords) {
    const target = normalizeJoinAnswerText(keyword);
    const tolerance = fuzzyTolerance(target.length);
    if (tolerance > 0 && containsApproximately(answer, target, tolerance)) return keyword;
  }
  return null;
}

function fuzzyTolerance(length: number) {
  if (length >= 8) return 2;
  if (length >= 4) return 1;
  return 0;
}

// 在 answer 中找一段与 target 编辑距离不超过 tolerance 的子串（近似子串匹配）。
function containsApproximately(answer: string, target: string, tolerance: number) {
  const a = [...answer];
  const t = [...target];
  if (a.length < t.length - tolerance) return false;
  let prev = new Array<number>(a.length + 1).fill(0);
  for (let i = 1; i <= t.length; i += 1) {
    const current = new Array<number>(a.length + 1);
    current[0] = i;
    for (let j = 1; j <= a.length; j += 1) {
      const cost = t[i - 1] === a[j - 1] ? 0 : 1;
      current[j] = Math.min(prev[j] + 1, current[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = current;
  }
  return Math.min(...prev) <= tolerance;
}
