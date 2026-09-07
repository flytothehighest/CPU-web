import { h } from "vue";
import { ElMessageBox } from "element-plus";
import { getToken, COOKIE_SESSION_MARKER } from "@/api/request";

export type AiDisclosure = {
  version: string; ready: boolean; agreed: boolean; agreedAt?: string | null;
  purposes: string; data: string; choice: string;
  recipients: Array<{ name: string; host: string; operator: string; policyUrl: string; retention: string; local: boolean; ready: boolean }>;
};
let pending: Promise<void> | null = null;

function privacyHeaders() {
  const headers: Record<string, string> = { "Content-Type": "application/json", "X-CPU-Auth-Mode": "cookie" };
  const csrf = document.cookie.split(";").map((part) => part.trim()).find((part) => /^(?:__Host-)?cpu-csrf=/.test(part));
  if (csrf) headers["X-CSRF-Token"] = decodeURIComponent(csrf.slice(csrf.indexOf("=") + 1));
  const token = getToken();
  if (token && token !== COOKIE_SESSION_MARKER) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function fetchAiDisclosure(): Promise<AiDisclosure> {
  const response = await fetch("/api/privacy/ai", { credentials: "include", headers: privacyHeaders(), cache: "no-store" });
  const body = await response.json();
  if (!response.ok || body.code !== 0) throw new Error(body.message || "AI 声明读取失败");
  return body.data;
}

export async function setAiConsent(version: string, agree: boolean) {
  const response = await fetch("/api/privacy/ai", { method: "POST", credentials: "include", headers: privacyHeaders(), body: JSON.stringify({ version, agree }) });
  const body = await response.json();
  if (!response.ok || body.code !== 0) throw new Error(body.message || "AI 同意状态保存失败");
}

export async function ensureAiConsent() {
  if (pending) return pending;
  pending = (async () => {
    const disclosure = await fetchAiDisclosure();
    if (!disclosure.ready) throw new Error("AI 服务尚未完成数据接收方说明，暂不发送你的内容。请稍后再试。");
    if (disclosure.agreed) return;
    await ElMessageBox.confirm(h("div", { style: "max-height:60vh;overflow:auto;line-height:1.7" }, [
      h("p", disclosure.purposes), h("p", disclosure.data),
      ...disclosure.recipients.map((recipient) => h("div", { style: "margin:12px 0" }, [
        h("strong", `${recipient.operator}（${recipient.name} · ${recipient.host}）`), h("p", recipient.retention),
        h("a", { href: recipient.policyUrl, target: "_blank", rel: "noopener noreferrer" }, "查看接收方隐私政策"),
      ])), h("p", disclosure.choice),
      h("a", { href: "/ai-privacy.html", target: "_blank", rel: "noopener noreferrer" }, "完整 AI 数据共享声明"),
    ]), "AI 数据共享说明", { confirmButtonText: "同意并继续", cancelButtonText: "暂不同意", closeOnClickModal: false, distinguishCancelAndClose: true });
    await setAiConsent(disclosure.version, true);
  })().finally(() => { pending = null; });
  return pending;
}

export function requiresAiConsentForRequest(method: string, url: string) {
  if (!["post", "patch", "put"].includes(method.toLowerCase())) return false;
  return /^\/(?:topics\/smart-compose(?:\?|$)|search\/assistant(?:\/|$)|direct-messages\/.*\/messages(?:\/|$))/.test(url)
    && !/\/(?:impressions|manual-review|read|history)(?:\/|$)/.test(url);
}
