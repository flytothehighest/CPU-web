import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { prisma } from "../prisma";
import { HttpError } from "../utils/response";
import { getSiteConfig, resolveAiServiceCandidatesForScene, type AiServiceConfig } from "./siteSettings";

export const aiActorContext = new AsyncLocalStorage<number>();
export const AI_PRIVACY_REVISION = "2026-09-07.1";
const scenes = ["assistant", "learning-assistant", "smart-post", "text-review", "image-review", "video-review"] as const;

export function describeAiRecipient(service: Pick<AiServiceConfig, "name" | "apiUrl" | "privacyOperator" | "privacyPolicyUrl" | "privacyRetention"> & { provider?: string }) {
  let host = "";
  try { host = new URL(service.apiUrl).hostname.toLowerCase(); } catch { /* Invalid endpoints cannot receive user data. */ }
  const local = service.provider === "ollama" && ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);
  const known = host === "api.deepseek.com"
    ? { operator: "DeepSeek", policyUrl: "https://cdn.deepseek.com/policies/zh-CN/deepseek-privacy-policy.html" }
    : host === "api.openai.com"
      ? { operator: "OpenAI", policyUrl: "https://openai.com/policies/privacy-policy/" }
      : null;
  const operator = service.privacyOperator || (local ? "药大拾间本机模型服务" : known?.operator || "");
  const policyUrl = service.privacyPolicyUrl || (local ? "/privacy.html" : known?.policyUrl || "");
  const retention = service.privacyRetention || (local
    ? "推理在本站服务中处理；站内对话记录由用户删除，审核记录随账户删除。"
    : known ? "接收方可能为安全和服务运行保留请求记录，具体期限与处理权利见其隐私政策；本站不承诺其零留存。" : "");
  const safePolicy = policyUrl === "/privacy.html" || /^https:\/\//i.test(policyUrl);
  return { name: service.name, host, operator, policyUrl: safePolicy ? policyUrl : "", retention, local, ready: Boolean(host && operator && safePolicy && retention) };
}

export function currentAiDisclosure() {
  const config = getSiteConfig();
  const recipients = new Map<string, ReturnType<typeof describeAiRecipient>>();
  for (const scene of scenes) {
    for (const candidate of resolveAiServiceCandidatesForScene(config, scene)) {
      if (!candidate.apiKey && candidate.provider !== "ollama") continue;
      const configured = config.aiServices.find((service) => service.id === candidate.serviceId);
      const recipient = describeAiRecipient({ ...candidate, ...configured });
      recipients.set(`${recipient.host}:${recipient.operator}`, recipient);
    }
  }
  const list = [...recipients.values()].sort((a, b) => a.host.localeCompare(b.host));
  const version = `${AI_PRIVACY_REVISION}:${createHash("sha256").update(JSON.stringify(list)).digest("hex").slice(0, 24)}`;
  return {
    version,
    ready: list.every((recipient) => recipient.ready),
    recipients: list,
    purposes: "AI 对话、智慧发帖及内容安全审核。内容审核包括帖子、回复、私信、昵称、上传图片、视频抽帧与音频转写；并非端到端加密私信。",
    data: "仅发送完成所选功能所需的文字、所选历史消息、图片或视频片段及必要上下文。请勿提交学校密码、证件号码或他人的敏感信息。",
    choice: "同意是可选的。拒绝或撤回后仍可登录、查看课表和浏览内容；依赖 AI 处理的操作会暂停，个人资料可走人工审核。已经发送的数据不能通过撤回追溯取消。",
  };
}

export async function ensureUserAiConsent(userId: number | null | undefined) {
  if (!userId) throw new HttpError(403, 4120, "请登录并在账号与隐私中确认 AI 数据共享声明");
  const disclosure = currentAiDisclosure();
  if (!disclosure.ready) throw new HttpError(503, 4121, "AI 服务接收方信息尚未完整配置，暂不发送用户数据");
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { aiConsentVersion: true, aiConsentAgreedAt: true, status: true } });
  if (!user || ["deleting", "deleted", "banned"].includes(user.status) || !user.aiConsentAgreedAt || user.aiConsentVersion !== disclosure.version) {
    throw new HttpError(403, 4120, "请先阅读并同意当前 AI 数据共享声明；可在账号与隐私中管理");
  }
}

export async function ensureContextAiConsent() {
  const userId = aiActorContext.getStore();
  if (userId) await ensureUserAiConsent(userId);
}
