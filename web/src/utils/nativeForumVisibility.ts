export const NATIVE_RESTRICTED_USERNAME = "2020240384";

export function hidesHarmonyForum(username: string | null | undefined, harmony: boolean) {
  return harmony && String(username || "").trim() === NATIVE_RESTRICTED_USERNAME;
}

/** Include forum-backed announcements, public profiles and governance pages. */
export function isForumDestination(destination: string) {
  try {
    const url = new URL(destination, "https://cpu.local");
    const path = decodeURIComponent(url.pathname).replace(/\\/g, "/");
    return /^\/(?:forum|market|post|coursereview|u|announcements|admin)(?:\/|$)/i.test(path)
      || /^\/community-rules(?:\.html)?(?:\/|$)/i.test(path)
      || (path === "/messages" && (["private", "reply", "like", "system"].includes(url.searchParams.get("tab") || "")
        || ["conversation", "user", "forumKind", "forumId"].some((key) => url.searchParams.has(key))));
  } catch {
    return false;
  }
}

type Notice = { category?: string; link?: string | null; payload?: Record<string, unknown> };

export function visibleNativeNotices<T extends Notice>(notices: T[], hidden: boolean): T[] {
  if (!hidden) return notices;
  // System notices also contain moderation and reputation details. Keep only
  // the independent service channels while this account has no community UI.
  return notices.filter((notice) => ["service-tool", "lost-found"].includes(notice.category || "")
    && !isForumDestination(notice.link || "")
    && !notice.payload?.topicId && !notice.payload?.replyId && !notice.payload?.forumId);
}
