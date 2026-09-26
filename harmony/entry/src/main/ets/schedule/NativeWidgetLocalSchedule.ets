import {
  NativeCalendarWeek,
  NativeCourseBlock,
  NativeScheduleAdjustment,
  NativeScheduleCalendar,
  NativeScheduleCell,
  NativeSchedulePeriod,
  NativeScheduleSnapshot
} from './NativeScheduleStore';
import { OffDay, PublishedHoliday, publishedHolidaysFromOffDays } from '../common/ChineseCalendar';

// App 里拿到的课表按日期展开，写给桌面卡片读，卡片不再请求服务端。格式与 iOS
// NativeWidgetLocalSchedule.swift 的 Record 一致（docs/schedule-widget-rules.md 第 7 节）。
// 整学期的快照整份覆盖；只按周取的快照只替换那一周的日子。

export interface LocalScheduleCourse {
  name: string;
  teacher?: string;
  location?: string;
  note?: string;
  slotNote?: string;
  startTime?: string;
  endTime?: string;
  startSlot?: number;
  endSlot?: number;
}

export interface LocalScheduleDay {
  day: number;
  label: string;
  date: string;
  week: number;
  courses: LocalScheduleCourse[];
}

export interface LocalScheduleRecord {
  semester: string;
  days: LocalScheduleDay[];
  // 调休表里的法定放假日，卡片拿去覆盖离线推算的假期。
  holidays?: PublishedHoliday[];
}

// 某周某天合并好的课块，由课表页的合并规则提供（NativeScheduleStore.blocksInWeek）。
export type LocalScheduleBlocks = (cells: NativeScheduleCell[], day: number, week: number) => NativeCourseBlock[];

interface ResolvedDay {
  day: number;
  week: number;
}

const DAY_LABELS: string[] = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

// 网页桥接层还没带 periods 时的节次时间，与网页课表一致。
const BUNDLED_PERIODS: NativeSchedulePeriod[] = [
  { number: 1, startTime: '08:00', endTime: '08:45' }, { number: 2, startTime: '08:55', endTime: '09:40' },
  { number: 3, startTime: '09:55', endTime: '10:40' }, { number: 4, startTime: '10:50', endTime: '11:35' },
  { number: 5, startTime: '13:30', endTime: '14:15' }, { number: 6, startTime: '14:25', endTime: '15:10' },
  { number: 7, startTime: '15:25', endTime: '16:10' }, { number: 8, startTime: '16:20', endTime: '17:05' },
  { number: 9, startTime: '18:30', endTime: '19:15' }, { number: 10, startTime: '19:25', endTime: '20:10' },
  { number: 11, startTime: '20:20', endTime: '21:05' }
];

function dayLabel(day: number): string {
  return day >= 1 && day <= 7 ? DAY_LABELS[day - 1] : `周${day}`;
}

// 周一为 1、周日为 7；日期不合法返回 0。
export function localWeekday(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return 0;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const value = new Date(Date.UTC(year, month - 1, day));
  if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day) return 0;
  const weekday = value.getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function trimmed(value?: string): string {
  return (value ?? '').trim();
}

// 调休：放假返回 undefined，补课换成被补的那一天。和 iOS 的规则一样。
function resolvedDay(date: string, day: number, week: number, calendar: NativeScheduleCalendar): ResolvedDay | undefined {
  const adjustment = (calendar.adjustments ?? []).find((item: NativeScheduleAdjustment) => item.date === date);
  if (!adjustment) return { day, week };
  if (adjustment.kind === 'off') return undefined;
  if (adjustment.kind === 'swap') {
    const source = trimmed(adjustment.source);
    if (!source) return undefined;
    const sourceWeek = calendar.weeks.find((item: NativeCalendarWeek) => (item.days ?? []).includes(source));
    const sourceDay = localWeekday(source);
    if (!sourceWeek || !sourceDay) return undefined;
    return { day: sourceDay, week: sourceWeek.week };
  }
  return { day, week };
}

function compareCourse(left: LocalScheduleCourse, right: LocalScheduleCourse): number {
  const a = left.startTime ?? '';
  const b = right.startTime ?? '';
  if (a !== b) return a < b ? -1 : 1;
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

// `existing` 是上一次写的那份：只按周取的快照缺别的周的课，同一学期时保留那些日子。
export function localScheduleRecord(
  snapshot: NativeScheduleSnapshot,
  blocks: LocalScheduleBlocks,
  existing?: LocalScheduleRecord
): LocalScheduleRecord | undefined {
  const data = snapshot.data;
  const calendar = snapshot.calendar;
  if (!data || !calendar || !data.currentSemester || !Array.isArray(calendar.weeks)) return undefined;
  let coveredWeeks: number[] = [];
  if (snapshot.completeSemester) {
    coveredWeeks = calendar.weeks.map((week: NativeCalendarWeek) => week.week);
  } else {
    const week = Number(data.currentWeek);
    if (!data.currentWeek || !Number.isInteger(week)) return undefined;
    coveredWeeks = [week];
  }
  const periods = snapshot.periods && snapshot.periods.length > 0 ? snapshot.periods : BUNDLED_PERIODS;
  const periodTimes: Map<number, NativeSchedulePeriod> = new Map<number, NativeSchedulePeriod>();
  periods.forEach((period: NativeSchedulePeriod) => {
    if (!periodTimes.has(period.number)) periodTimes.set(period.number, period);
  });

  const byDate: Map<string, LocalScheduleDay> = new Map<string, LocalScheduleDay>();
  calendar.weeks.filter((week: NativeCalendarWeek) => coveredWeeks.includes(week.week)).forEach((week: NativeCalendarWeek) => {
    (week.days ?? []).forEach((date: string) => {
      // 星期按日期本身算：教务的周历有的从周日排起，下标不一定是星期几。
      const day = localWeekday(date);
      if (!day || byDate.has(date)) return;
      const resolved = resolvedDay(date, day, week.week, calendar);
      if (!resolved) {
        // 放假：这一天明确没课。
        byDate.set(date, { day, label: dayLabel(day), date, week: week.week, courses: [] });
        return;
      }
      const courses = blocks(data.cells, resolved.day, resolved.week).map((block: NativeCourseBlock): LocalScheduleCourse => {
        const course = block.course;
        const slotNote = trimmed(course.slotNote);
        const weeks = trimmed(course.weeks);
        const customStart = trimmed(course.customStartTime);
        const customEnd = trimmed(course.customEndTime);
        return {
          name: course.name,
          teacher: course.teacher,
          location: course.location,
          // 和服务端一样：先节次备注，没有就写上课周次。
          note: slotNote || weeks || undefined,
          slotNote: slotNote || undefined,
          startTime: customStart || periodTimes.get(block.startSlot)?.startTime,
          endTime: customEnd || periodTimes.get(block.endSlot)?.endTime,
          startSlot: block.startSlot,
          endSlot: block.endSlot
        };
      }).sort(compareCourse);
      byDate.set(date, { day, label: dayLabel(day), date, week: week.week, courses });
    });
  });
  if (byDate.size === 0) return undefined;

  const offDays: OffDay[] = (calendar.adjustments ?? [])
    .filter((item: NativeScheduleAdjustment) => item.kind === 'off')
    .map((item: NativeScheduleAdjustment): OffDay => ({ date: item.date, note: item.note ?? '' }));
  let holidays = publishedHolidaysFromOffDays(offDays);
  if (!snapshot.completeSemester && existing && existing.semester === data.currentSemester) {
    (existing.days ?? []).forEach((day: LocalScheduleDay) => {
      if (!byDate.has(day.date)) byDate.set(day.date, day);
    });
    if (holidays.length === 0) holidays = existing.holidays ?? [];
  }
  const days: LocalScheduleDay[] = [];
  byDate.forEach((day: LocalScheduleDay) => days.push(day));
  days.sort((left: LocalScheduleDay, right: LocalScheduleDay) => left.date < right.date ? -1 : left.date > right.date ? 1 : 0);
  return { semester: data.currentSemester, days, holidays };
}
