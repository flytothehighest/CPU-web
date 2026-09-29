import assert from "node:assert/strict";
import test from "node:test";
import { clampSlot, normalizeSlotRange, normalizeSlotRangeForTablePosition } from "../src/views/schedule/slots";
import { createCustomCourseForm, fillFormForNewCourse, buildCustomCourseItem } from "../src/views/schedule/courseEditor";
import { createScheduleViewModelHelpers } from "../src/views/schedule/viewModels";
import type { ScheduleResult } from "../src/views/schedule/types";

test("twelfth-period courses and the sixth big slot retain their full ranges", () => {
  const course = { name: "晚间实验", weeks: "1周", weekList: [1] };
  assert.deepEqual(normalizeSlotRange(6, course), { start: 11, end: 12 });
  assert.deepEqual(normalizeSlotRange(6, { ...course, startSlot: 12, endSlot: 12 }), { start: 12, end: 12 });
  assert.deepEqual(normalizeSlotRangeForTablePosition(6, { ...course, startSlot: 11, endSlot: 12 }), { start: 11, end: 12 });
  assert.equal(clampSlot(99), 12);
  const source: ScheduleResult = {
    currentSemester: "fall", currentWeek: "1", semesters: [], weeks: [],
    cells: [
      { day: 1, bigSlot: 6, courses: [{ ...course, startSlot: 12, endSlot: 12 }] },
      { day: 2, bigSlot: 6, courses: [{ ...course, startSlot: 11, endSlot: 12 }] },
    ],
  };
  const helpers = createScheduleViewModelHelpers({
    calendar: () => null, parsed: () => source, weeks: () => [{ value: "1" }],
    scheduleEdits: () => ({ hidden: [], custom: [] }), activeDay: () => 1,
    currentWeekValue: () => "1", scheduleForWeek: () => source, allKnownScheduleSources: () => [source],
  });
  assert.deepEqual(helpers.weekCourseBlocksFor(1).sort((a, b) => a.day - b.day).map(b => [b.day, b.startSlot, b.endSlot]), [[1, 12, 12], [2, 11, 12]]);
  assert.deepEqual(helpers.dayCourseBlocksFor(1, 1).map(b => [b.startSlot, b.endSlot]), [[12, 12]]);
});

test("creating and saving a course at period twelve does not move it to eleven", () => {
  const form = createCustomCourseForm(1);
  fillFormForNewCourse(form, { day: 1, slot: 12, targetWeek: "1", activeWeekNumber: 1, currentWeek: "1" });
  form.name = "晚间实验";
  const { item } = buildCustomCourseItem(form, { weekList: [1] });
  assert.equal(item?.bigSlot, 6);
  assert.equal(item?.course.startSlot, 12);
  assert.equal(item?.course.endSlot, 12);
  form.startSlot = 11;
  assert.equal(buildCustomCourseItem(form, { weekList: [1] }).item.course.endSlot, 12);
});
