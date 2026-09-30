import { coupleApi, type CoupleStatus } from "@/api/couple";
import { applyScheduleEditsToCells, type ScheduleEditState } from "@/utils/scheduleEdits";
import { snapshotFingerprint } from "./couple";
import type { CalendarResult, ScheduleResult } from "./types";

const STATUS_KEY = "cpu-couple-status-v1";
const SYNC_KEY = "cpu-couple-sync-v1";
// 未绑定时不必每次打开课表都问服务端。
const UNBOUND_STATUS_TTL_MS = 10 * 60 * 1000;
// 只有周视图数据时，拉取整学期课表需要再请求一次教务，所以限制频率。
const WEEKLY_SOURCE_RESYNC_MS = 6 * 60 * 60 * 1000;
// 内容没变时也定期刷新“同步于”时间，让对方知道这份课表仍然可信。
const UNCHANGED_RESYNC_MS = 12 * 60 * 60 * 1000;

type StoredStatus = { userId: number; status: CoupleStatus["status"]; checkedAt: number };
type StoredSync = { userId: number; semester: string; editsHash: string; hash: string; syncedAt: number };

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 存储不可用时每次都重新检查 */ }
}

/** 情侣课表页状态变化后调用，让课表页立即按新状态决定是否同步。 */
export function rememberCoupleStatus(userId: number | null | undefined, status: CoupleStatus["status"]) {
  if (!userId) return;
  writeJson(STATUS_KEY, { userId, status, checkedAt: Date.now() } satisfies StoredStatus);
  if (status !== "active") {
    try { localStorage.removeItem(SYNC_KEY); } catch { /* ignore */ }
  }
}

/** 未过期的“未绑定”缓存返回 "none"，其余情况都需要问服务端。 */
export function readCachedCoupleStatus(userId: number, now = Date.now()) {
  const cached = readJson<StoredStatus>(STATUS_KEY);
  return cached?.userId === userId && cached.status === "none" && now - cached.checkedAt < UNBOUND_STATUS_TTL_MS ? "none" : null;
}

type CoupleSyncApi = Pick<typeof coupleApi, "status" | "syncSchedule">;

async function isBound(api: CoupleSyncApi, userId: number, now: number) {
  const cached = readJson<StoredStatus>(STATUS_KEY);
  if (cached?.userId === userId && cached.status !== "active" && now - cached.checkedAt < UNBOUND_STATUS_TTL_MS) return false;
  const status = await api.status(true);
  rememberCoupleStatus(userId, status.status);
  return status.status === "active";
}

export interface CoupleSyncInput {
  userId: number | null | undefined;
  semester: string;
  parsed: ScheduleResult;
  calendar: CalendarResult;
  edits: ScheduleEditState;
  /** 当前页面只有单周数据时，用它拉取整学期课表。 */
  loadSemesterSchedule?: () => Promise<ScheduleResult>;
  now?: number;
  api?: CoupleSyncApi;
}

/**
 * 已绑定情侣课表时，把当前学期完整课表（含自定义修改）同步给服务端。
 * 全部失败都静默处理：同步是附带功能，不能影响课表本身。
 */
export async function syncCoupleScheduleIfBound(input: CoupleSyncInput): Promise<"skipped" | "unchanged" | "synced"> {
  const now = input.now ?? Date.now();
  const api = input.api ?? coupleApi;
  if (!input.userId || !input.semester) return "skipped";
  try {
    if (!await isBound(api, input.userId, now)) return "skipped";
    const editsHash = snapshotFingerprint(input.edits);
    const last = readJson<StoredSync>(SYNC_KEY);
    const sameTarget = last?.userId === input.userId && last.semester === input.semester;
    let source = input.parsed;
    if (source.scope !== "semester") {
      if (!input.loadSemesterSchedule) return "skipped";
      if (sameTarget && last.editsHash === editsHash && now - last.syncedAt < WEEKLY_SOURCE_RESYNC_MS) return "unchanged";
      source = await input.loadSemesterSchedule();
      if (source.currentSemester && source.currentSemester !== input.semester) return "skipped";
    }
    const schedule: ScheduleResult = { ...source, cells: applyScheduleEditsToCells(source.cells, input.edits) };
    const payload = { semester: input.semester, schedule, calendar: input.calendar };
    const hash = snapshotFingerprint(payload);
    if (sameTarget && last.hash === hash && now - last.syncedAt < UNCHANGED_RESYNC_MS) return "unchanged";
    await api.syncSchedule(payload);
    writeJson(SYNC_KEY, { userId: input.userId, semester: input.semester, editsHash, hash, syncedAt: now } satisfies StoredSync);
    return "synced";
  } catch {
    return "skipped";
  }
}
