import assert from "node:assert/strict";
import test from "node:test";
import { emptyScheduleEdits } from "../src/utils/scheduleEdits";
import { rememberCoupleStatus, syncCoupleScheduleIfBound } from "../src/views/schedule/coupleSync";
import type { CalendarResult, ScheduleResult } from "../src/views/schedule/types";

const store = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)); },
    removeItem: (key: string) => { store.delete(key); },
  },
});

const calendar: CalendarResult = { currentWeek: 1, semesterStart: "2026-09-07", semesterEnd: "2027-01-10", weeks: [] };
function schedule(scope: ScheduleResult["scope"], name = "药理学"): ScheduleResult {
  return {
    scope,
    semesters: [],
    weeks: [],
    currentSemester: "2026-2027-1",
    currentWeek: "1",
    cells: [{ day: 1, bigSlot: 1, courses: [{ name, weeks: "1-16周", weekList: [1] }] }],
  };
}

function fakeApi(status: "none" | "pending" | "active") {
  const calls = { status: 0, sync: [] as Array<{ schedule: ScheduleResult }> };
  return {
    calls,
    api: {
      status: async () => { calls.status += 1; return { status } as any; },
      syncSchedule: async (payload: any) => { calls.sync.push(payload); return {} as any; },
    },
  };
}

test.beforeEach(() => store.clear());

test("does nothing for unbound users and caches that answer", async () => {
  const { api, calls } = fakeApi("none");
  const input = { userId: 7, semester: "2026-2027-1", parsed: schedule("semester"), calendar, edits: emptyScheduleEdits(), api };
  assert.equal(await syncCoupleScheduleIfBound(input), "skipped");
  assert.equal(await syncCoupleScheduleIfBound(input), "skipped");
  assert.equal(calls.status, 1);
  assert.equal(calls.sync.length, 0);
});

test("uploads once and skips unchanged content", async () => {
  const { api, calls } = fakeApi("active");
  const input = { userId: 7, semester: "2026-2027-1", parsed: schedule("semester"), calendar, edits: emptyScheduleEdits(), api };
  assert.equal(await syncCoupleScheduleIfBound(input), "synced");
  assert.equal(await syncCoupleScheduleIfBound(input), "unchanged");
  assert.equal(await syncCoupleScheduleIfBound({ ...input, parsed: schedule("semester", "生物化学") }), "synced");
  assert.equal(calls.sync.length, 2);
  // 内容不变超过 12 小时后刷新“同步于”。
  assert.equal(await syncCoupleScheduleIfBound({ ...input, parsed: schedule("semester", "生物化学"), now: Date.now() + 13 * 3_600_000 }), "synced");
});

test("weekly pages fetch the full semester at most every six hours", async () => {
  const { api, calls } = fakeApi("active");
  let loads = 0;
  const input = {
    userId: 7,
    semester: "2026-2027-1",
    parsed: schedule("week"),
    calendar,
    edits: emptyScheduleEdits(),
    api,
    loadSemesterSchedule: async () => { loads += 1; return schedule("semester"); },
  };
  assert.equal(await syncCoupleScheduleIfBound(input), "synced");
  assert.equal(await syncCoupleScheduleIfBound(input), "unchanged");
  assert.equal(loads, 1);
  assert.equal(calls.sync[0].schedule.scope, "semester");
  // 自定义修改变化后立即重新同步。
  const edits = {
    hidden: [],
    custom: [{ id: "c1", day: 3, bigSlot: 2, course: { name: "社团活动", weeks: "1周", weekList: [1], custom: true, customId: "c1" } }],
  };
  assert.equal(await syncCoupleScheduleIfBound({ ...input, edits }), "synced");
  assert.equal(loads, 2);
  assert.ok(calls.sync[1].schedule.cells.some((cell) => cell.courses.some((course) => course.name === "社团活动")));
});

test("binding from the couple page makes the next schedule visit sync immediately", async () => {
  const { api, calls } = fakeApi("active");
  rememberCoupleStatus(7, "none");
  rememberCoupleStatus(7, "active");
  assert.equal(await syncCoupleScheduleIfBound({ userId: 7, semester: "2026-2027-1", parsed: schedule("semester"), calendar, edits: emptyScheduleEdits(), api }), "synced");
  assert.equal(calls.sync.length, 1);
});

test("failures never throw into the schedule page", async () => {
  const api = { status: async () => { throw new Error("offline"); }, syncSchedule: async () => ({}) as any };
  assert.equal(await syncCoupleScheduleIfBound({ userId: 7, semester: "s", parsed: schedule("semester"), calendar, edits: emptyScheduleEdits(), api }), "skipped");
});
