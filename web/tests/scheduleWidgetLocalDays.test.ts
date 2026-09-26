import assert from "node:assert/strict";
import test from "node:test";
import { createScheduleViewModelHelpers } from "../src/views/schedule/viewModels";
import {
  buildScheduleWidgetLocalRecord,
  clearAndroidScheduleWidgetLocalDays,
  publishedHolidaysFromOffDays,
  saveAndroidScheduleWidgetLocalDays,
  syncAndroidScheduleWidgetOwner,
} from "../src/views/schedule/widgetLocalDays";
import type { CalendarResult, ScheduleResult } from "../src/views/schedule/types";

function week(no: number, monday: string): CalendarResult["weeks"][number] {
  const start = new Date(`${monday}T00:00:00Z`);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start.getTime() + index * 86_400_000);
    return date.toISOString().slice(0, 10);
  });
  return { week: no, days, monday: days[0], sunday: days[6] };
}

function fixture(scope: ScheduleResult["scope"] = "semester") {
  const schedule: ScheduleResult = {
    scope,
    currentSemester: "2026-2027-1",
    currentWeek: "5",
    semesters: [{ value: "2026-2027-1", label: "2026-2027-1", current: true }],
    weeks: [],
    cells: [
      // 周四 1-2 节，第 1-16 周。
      { day: 4, bigSlot: 1, courses: [{ name: "药剂学", teacher: "苏老师", location: "E104", weeks: "1-16周", weekList: [], startSlot: 1, endSlot: 2 }] },
      // 周五 5-6 节，只有第 6 周。
      { day: 5, bigSlot: 3, courses: [{ name: "药物分析", teacher: "陈老师", location: "B211", weeks: "6周", weekList: [6], startSlot: 5, endSlot: 6 }] },
    ],
  };
  const calendar: CalendarResult = {
    currentSemester: "2026-2027-1",
    currentWeek: 4,
    semesterStart: "2026-08-31",
    semesterEnd: "2027-01-17",
    weeks: [week(4, "2026-09-21"), week(5, "2026-09-28"), week(6, "2026-10-05")],
    periods: [
      { id: 1, name: "1", start: "08:10", end: "08:55" },
      { id: 2, name: "2", start: "09:05", end: "09:50" },
      { id: 5, name: "5", start: "13:30", end: "14:15" },
      { id: 6, name: "6", start: "14:25", end: "15:10" },
    ],
    adjustments: [
      { date: "2026-10-01", kind: "off", note: "国庆节、中秋节" },
      { date: "2026-10-02", kind: "off", note: "国庆节" },
      { date: "2026-09-24", kind: "off", note: "校运会停课" },
      // 10.10 周六补 10.9 周五（第 6 周）的课。
      { date: "2026-10-10", kind: "swap", source: "2026-10-09" },
    ],
  };
  const helpers = createScheduleViewModelHelpers({
    parsed: () => schedule, calendar: () => calendar, weeks: () => [],
    scheduleEdits: () => ({ hidden: [], custom: [] }), activeDay: () => 1, currentWeekValue: () => "5",
    scheduleForWeek: () => schedule, allKnownScheduleSources: () => [schedule],
  });
  return { schedule, calendar, helpers };
}

test("expands every calendar day and applies off / swap adjustments", () => {
  const { calendar, helpers } = fixture();
  const record = buildScheduleWidgetLocalRecord({
    semester: "2026-2027-1",
    calendar,
    complete: true,
    weeks: [],
    blocksForWeek: (value) => helpers.weekCourseBlocksFor(value),
  });
  assert.ok(record);
  assert.equal(record.days.length, 21);
  const byDate = new Map(record.days.map((day) => [day.date, day]));

  const thursday = byDate.get("2026-10-08")!;
  assert.equal(thursday.label, "周四");
  assert.equal(thursday.day, 4);
  assert.equal(thursday.week, 6);
  assert.deepEqual(thursday.courses, [{
    name: "药剂学", teacher: "苏老师", location: "E104", note: "01-02节", slotNote: "01-02节",
    startTime: "08:10", endTime: "09:50", startSlot: 1, endSlot: 2,
  }]);

  // 放假日（含学校停课）写成空课表。
  assert.deepEqual(byDate.get("2026-10-01")!.courses, []);
  assert.deepEqual(byDate.get("2026-09-24")!.courses, []);
  // 补课日写成被调换那天的课。
  const makeup = byDate.get("2026-10-10")!;
  assert.equal(makeup.label, "周六");
  assert.deepEqual(makeup.courses.map((course) => [course.name, course.startTime]), [["药物分析", "13:30"]]);
  // 被调换出去的那天照常上课（调休表没说它放假）。
  assert.deepEqual(byDate.get("2026-10-09")!.courses.map((course) => course.name), ["药物分析"]);
  assert.deepEqual(byDate.get("2026-10-02")!.courses, []);

  // 只有法定节日进 holidays，名字取说明里先出现的那个。
  assert.deepEqual(record.holidays, [
    { date: "2026-10-01", name: "国庆节" },
    { date: "2026-10-02", name: "国庆节" },
  ]);
  assert.equal(record.complete, true);
});

test("a week-only snapshot writes just the weeks it has", () => {
  const { calendar, helpers } = fixture("week");
  const record = buildScheduleWidgetLocalRecord({
    semester: "2026-2027-1",
    calendar,
    complete: false,
    weeks: [5],
    blocksForWeek: (value) => helpers.weekCourseBlocksFor(value),
  });
  assert.ok(record);
  assert.equal(record.complete, false);
  assert.deepEqual([...new Set(record.days.map((day) => day.week))], [5]);
  assert.equal(record.days[0].date, "2026-09-28");
});

test("returns nothing without a semester or calendar", () => {
  const { calendar, helpers } = fixture();
  const blocksForWeek = (value: number) => helpers.weekCourseBlocksFor(value);
  assert.equal(buildScheduleWidgetLocalRecord({ semester: "", calendar, complete: true, weeks: [], blocksForWeek }), null);
  assert.equal(buildScheduleWidgetLocalRecord({ semester: "2026-2027-1", calendar: null, complete: true, weeks: [], blocksForWeek }), null);
});

test("statutory holiday names follow the iOS rule", () => {
  assert.deepEqual(publishedHolidaysFromOffDays([
    { date: "2026-09-27", note: "中秋节放假" },
    { date: "2026-09-25", note: "中秋节" },
    { date: "2026-10-20", note: "校运会" },
    { date: "2026-10-03", note: "国庆节、中秋节" },
  ]), [
    { date: "2026-09-25", name: "中秋节" },
    { date: "2026-09-27", name: "中秋节" },
    { date: "2026-10-03", name: "国庆节" },
  ]);
});

test("hands the record to the Android bridge and clears it when the account changes", () => {
  const sent: string[] = [];
  let cleared = 0;
  const storage = new Map<string, string>();
  const globals = globalThis as any;
  const previousWindow = globals.window;
  const previousStorage = globals.localStorage;
  globals.window = {
    CPUAndroid: {
      saveScheduleWidgetLocalDays: (json: string) => { sent.push(json); return true; },
      clearScheduleWidgetLocalDays: () => { cleared += 1; },
    },
  };
  globals.localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
  };
  try {
    const { calendar, helpers } = fixture();
    const record = buildScheduleWidgetLocalRecord({
      semester: "2026-2027-1", calendar, complete: true, weeks: [],
      blocksForWeek: (value) => helpers.weekCourseBlocksFor(value),
    });
    assert.equal(saveAndroidScheduleWidgetLocalDays(record), true);
    assert.equal(saveAndroidScheduleWidgetLocalDays(record), true);
    assert.equal(sent.length, 1, "unchanged records are not re-sent");
    assert.equal(JSON.parse(sent[0]).semester, "2026-2027-1");

    syncAndroidScheduleWidgetOwner("1");
    assert.equal(cleared, 0, "the first known account does not wipe its own schedule");
    syncAndroidScheduleWidgetOwner("1");
    syncAndroidScheduleWidgetOwner("2");
    assert.equal(cleared, 1);
    syncAndroidScheduleWidgetOwner("");
    assert.equal(cleared, 2);

    clearAndroidScheduleWidgetLocalDays();
    assert.equal(saveAndroidScheduleWidgetLocalDays(record), true);
    assert.equal(sent.length, 2, "after clearing the same record is sent again");
  } finally {
    globals.window = previousWindow;
    globals.localStorage = previousStorage;
  }
});
