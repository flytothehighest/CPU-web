import assert from "node:assert/strict";
import test from "node:test";
import {
  chinaClock,
  createSnapshotDayReader,
  daysTogether,
  describeNow,
  occupiedSlots,
  snapshotFingerprint,
  type CoupleScheduleSnapshot,
} from "../src/views/schedule/couple";
import type { CalendarResult, ScheduleCourse, ScheduleResult } from "../src/views/schedule/types";

function days(monday: string) {
  const start = Date.parse(`${monday}T00:00:00Z`);
  return Array.from({ length: 7 }, (_, i) => new Date(start + i * 86_400_000).toISOString().slice(0, 10));
}

function calendar(extra: Partial<CalendarResult> = {}): CalendarResult {
  const weeks = [1, 2].map((week) => {
    const list = days(week === 1 ? "2026-09-07" : "2026-09-14");
    return { week, days: list, monday: list[0], sunday: list[6] };
  });
  return { currentWeek: 1, semesterStart: "2026-09-07", semesterEnd: "2026-09-20", weeks, ...extra };
}

function course(name: string, startSlot: number, endSlot: number, extra: Partial<ScheduleCourse> = {}): ScheduleCourse {
  return { name, weeks: "1-2周", weekList: [1, 2], startSlot, endSlot, location: "A201", ...extra };
}

function snapshot(cells: ScheduleResult["cells"], cal = calendar()): CoupleScheduleSnapshot {
  return {
    semester: "2026-2027-1",
    syncedAt: "2026-09-07T00:00:00.000Z",
    changedAt: "2026-09-07T00:00:00.000Z",
    calendar: cal,
    schedule: { scope: "semester", semesters: [], weeks: [], currentSemester: "2026-2027-1", currentWeek: "1", cells },
  };
}

// 2026-09-08 是周二；北京时间 = UTC+8。
const at = (hhmm: string) => new Date(`2026-09-08T${hhmm}:00+08:00`);

test("chinaClock reads the date and minutes in Asia/Shanghai", () => {
  assert.deepEqual(chinaClock(new Date("2026-09-07T16:30:00Z")), { ymd: "2026-09-08", minutes: 30 });
});

test("describeNow follows a day of classes", () => {
  const data = snapshot([
    { day: 2, bigSlot: 2, courses: [course("药理学", 3, 4)] },
    { day: 2, bigSlot: 3, courses: [course("有机化学", 5, 6, { location: "B101" })] },
  ]);
  assert.equal(describeNow(data, at("08:30")).kind, "between");
  const inClass = describeNow(data, at("10:00"));
  assert.equal(inClass.kind, "in-class");
  if (inClass.kind === "in-class") {
    assert.equal(inClass.current.course.name, "药理学");
    assert.equal(inClass.current.end, "11:35");
    assert.equal(inClass.next?.course.name, "有机化学");
  }
  const lunch = describeNow(data, at("12:00"));
  assert.equal(lunch.kind, "between");
  if (lunch.kind === "between") assert.equal(lunch.next.start, "13:30");
  assert.deepEqual(describeNow(data, at("18:00")), { kind: "done", doneCount: 2 });
});

test("describeNow separates missing data, free days and dates outside the term", () => {
  assert.deepEqual(describeNow(null, at("10:00")), { kind: "no-data" });
  assert.deepEqual(describeNow(snapshot([]), at("10:00")), { kind: "free-day" });
  assert.deepEqual(describeNow(snapshot([]), new Date("2026-12-01T10:00:00+08:00")), { kind: "out-of-term" });
});

test("custom course times override the period table", () => {
  const data = snapshot([{ day: 2, bigSlot: 1, courses: [course("社团", 1, 1, { customStartTime: "07:30", customEndTime: "08:10" })] }]);
  const status = describeNow(data, at("07:45"));
  assert.equal(status.kind, "in-class");
});

test("holiday adjustments hide classes on days off", () => {
  const data = snapshot(
    [{ day: 2, bigSlot: 1, courses: [course("药理学", 1, 2)] }],
    calendar({ adjustments: [{ date: "2026-09-08", kind: "off" }] }),
  );
  assert.deepEqual(createSnapshotDayReader(data).blocksForDate("2026-09-08"), []);
  assert.equal(createSnapshotDayReader(data).blocksForDate("2026-09-15")?.length, 1);
});

test("occupiedSlots covers every period a merged block spans", () => {
  const blocks = createSnapshotDayReader(snapshot([
    { day: 2, bigSlot: 1, courses: [course("A", 1, 2)] },
    { day: 2, bigSlot: 3, courses: [course("B", 5, 8)] },
  ])).blocksForDate("2026-09-08");
  assert.deepEqual([...occupiedSlots(blocks)].sort((a, b) => a - b), [1, 2, 5, 6, 7, 8]);
  assert.equal(occupiedSlots(null).size, 0);
});

test("dates outside the partner's term read as unknown, not free", () => {
  assert.equal(createSnapshotDayReader(snapshot([])).blocksForDate("2027-03-01"), null);
  assert.equal(createSnapshotDayReader(null).blocksForDate("2026-09-08"), null);
});

test("daysTogether counts the anniversary itself as day one", () => {
  assert.equal(daysTogether("2026-09-08", "2026-09-08"), 1);
  assert.equal(daysTogether("2025-09-08", "2026-09-08"), 366);
  assert.equal(daysTogether("2026-10-01", "2026-09-08"), null);
});

test("snapshotFingerprint changes with content", () => {
  assert.equal(snapshotFingerprint({ a: 1 }), snapshotFingerprint({ a: 1 }));
  assert.notEqual(snapshotFingerprint({ a: 1 }), snapshotFingerprint({ a: 2 }));
});
