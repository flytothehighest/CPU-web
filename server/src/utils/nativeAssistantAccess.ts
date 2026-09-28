export const HARMONY_ASSISTANT_RESTRICTED_USERNAME = "2020240384";

export function shouldHideHarmonyAssistant(
  client: string,
  isLoggedIn: boolean,
  username?: string | null,
) {
  return client === "harmony"
    && (!isLoggedIn || String(username || "").trim() === HARMONY_ASSISTANT_RESTRICTED_USERNAME);
}

export function isCampusAssistantDestination(destination?: string | null) {
  try {
    const path = decodeURIComponent(new URL(String(destination || ""), "https://cpu.local").pathname)
      .replace(/\\/g, "/")
      .replace(/\/+$/, "");
    return path === "/search";
  } catch {
    return false;
  }
}
