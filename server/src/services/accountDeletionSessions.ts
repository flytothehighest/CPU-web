import { createHash } from "node:crypto";
import { prisma } from "../prisma";
import { buildRedisKey, deleteRedisKeys, isRedisConfigured } from "./redis";
import { deleteEphemeralValue, deleteSubjectCacheEntries, jwxtSessionKey } from "./cache";
import { decryptJwxtSensitiveJson } from "./jwxtSessionCrypto";
import { verifySessionTokenSignature } from "../utils/jwt";
import { logout } from "./jwxtTransport";
import { deleteJwxtSessionReplica, jwxtSessionReplicaKey } from "./jwxtSessionReplica";
import { scheduleWidgetSessions } from "./scheduleWidgetSession";

export function credentialHash(token: string) { return createHash("sha256").update(token).digest("hex"); }

export async function collectAccountSessions(userId: number, currentJwxtToken?: string) {
  const tokens = new Set<string>(currentJwxtToken ? [currentJwxtToken] : []);
  const keys = new Set<string>();
  const remembered = await scheduleWidgetSessions.latest(userId);
  if (remembered?.token) tokens.add(remembered.token);
  const widgets = await prisma.scheduleWidgetToken.findMany({ where: { userId }, select: { jwxtToken: true } });
  for (const widget of widgets) if (widget.jwxtToken) tokens.add(widget.jwxtToken);
  const prefix = buildRedisKey("auth", "browser-session") + ":";
  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.runtimeSession.findMany({ where: { key: { startsWith: prefix } }, orderBy: { key: "asc" }, take: 200, ...(cursor ? { cursor: { key: cursor }, skip: 1 } : {}) });
    for (const row of rows) {
      try {
        const session = decryptJwxtSensitiveJson<{ siteToken: string; jwxtToken?: string }>("browser-session", row.key.slice(prefix.length), row.value).value;
        if (verifySessionTokenSignature(session.siteToken).userId !== userId) continue;
        keys.add(row.key);
        if (session.jwxtToken) tokens.add(session.jwxtToken);
      } catch { /* An invalid session is unusable; never delete another subject's session by guessing. */ }
    }
    if (rows.length < 200) break;
    cursor = rows[rows.length - 1].key;
  }
  keys.add(buildRedisKey("jwxt", "user-session", String(userId)));
  return { tokens: [...tokens], sessionKeys: [...keys] };
}

export async function deleteAccountSessions(tokens: string[], sessionKeys: string[]) {
  const redisKeys = [...sessionKeys, ...tokens.map(jwxtSessionKey), ...tokens.map(jwxtSessionReplicaKey)];
  if (isRedisConfigured() && redisKeys.length && !await deleteRedisKeys(...redisKeys)) throw new Error("Redis session cleanup unavailable");
  await prisma.runtimeSession.deleteMany({ where: { key: { in: redisKeys } } });
  for (const key of sessionKeys) await deleteEphemeralValue(key);
  for (const token of tokens) {
    await deleteEphemeralValue(jwxtSessionKey(token));
    await deleteJwxtSessionReplica(token);
    await deleteSubjectCacheEntries(credentialHash(token).slice(0, 24));
    // An unavailable remote agent leaves the durable job pending for retry.
    await logout(token);
  }
}
