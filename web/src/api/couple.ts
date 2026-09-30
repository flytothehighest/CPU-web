import { request } from "./request";
import type { CalendarResult, ScheduleResult } from "@/views/schedule/types";
import type { CoupleColor, CoupleScheduleSnapshot } from "@/views/schedule/couple";

export type CoupleMemberSnapshotMeta = { semester: string; syncedAt: string; changedAt: string };

export type { CoupleColor };

export type CoupleMember = {
  id: number;
  color: CoupleColor;
  nickname: string;
  avatar: string | null;
  snapshot: CoupleMemberSnapshotMeta | null;
};

export type CoupleStatus =
  | { status: "none" }
  | { status: "pending"; invite: { code: string | null; expiresAt: string | null; expired: boolean } }
  | { status: "active"; since: string; anniversary: string | null; me: CoupleMember; partner: CoupleMember };

export type CoupleSchedules = { me: CoupleScheduleSnapshot | null; partner: CoupleScheduleSnapshot | null };

const noCache = { cacheTtlMs: 0 };
// 课表页后台同步不应弹出错误或把人带去登录页。
const backgroundOptions = { suppressErrorMessage: true, suppressAuthRedirect: true, suppressAuthMessage: true };

export const coupleApi = {
  status: (background = false) => request.get<CoupleStatus>("/couple", undefined, background ? { ...noCache, ...backgroundOptions } : noCache),
  invite: () => request.post<CoupleStatus>("/couple/invite"),
  cancelInvite: () => request.delete<CoupleStatus>("/couple/invite"),
  accept: (code: string) => request.post<CoupleStatus>("/couple/accept", { code }),
  unbind: () => request.delete<CoupleStatus>("/couple"),
  setAnniversary: (anniversary: string | null) => request.patch<CoupleStatus>("/couple", { anniversary }),
  setMyColor: (myColor: CoupleColor) => request.patch<CoupleStatus>("/couple", { myColor }),
  schedules: () => request.get<CoupleSchedules>("/couple/schedules", undefined, noCache),
  syncSchedule: (payload: { semester: string; schedule: ScheduleResult; calendar: CalendarResult }) =>
    request.put<{ changed: boolean; semester: string; syncedAt: string; changedAt: string }>("/couple/schedule", payload, backgroundOptions),
};
