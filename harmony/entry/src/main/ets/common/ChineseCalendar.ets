// 农历日期、传统节日与法定节假日，照 iOS ios_next/CpuTime/CpuTime/ChineseCalendar.swift 移植，文案一致。
//
// 这里只有纯计算，不引用任何系统模块：农历换算由调用方传入（鸿蒙用 @ohos.i18n 的 chinese 日历，
// 见 SystemLunarCalendar.ets），节日与放假区间在此之上推导。日期一律是 `yyyy-MM-dd` 字符串，
// 天数差按 UTC 日序号算，不受设备时区影响。

// 一天的农历日期。
export interface LunarDate {
  // 农历月 1...12（11 为冬月、12 为腊月）。
  month: number;
  // 农历日 1...30。
  day: number;
  isLeapMonth: boolean;
  // 六十甲子中的序号 1...60。
  cyclicalYear: number;
}

// `yyyy-MM-dd` → 农历；换算不了时返回 undefined。
export type LunarResolver = (date: string) => LunarDate | undefined;

// 服务端下发的一天法定放假（国务院放假安排，含连休里的周末），从学期调休表的放假行里挑出。
export interface PublishedHoliday {
  date: string;
  // 「中秋节」「国庆节」，已经规整成法定节日名。
  name: string;
}

// 调休表里 kind == "off" 的一行。
export interface OffDay {
  date: string;
  note: string;
}

// 一段放假区间（含首尾）。
export interface HolidayWindow {
  name: string;
  start: string;
  end: string;
}

// 「还有几天放假」。daysAway 为 0 表示今天就在假期里。
export interface HolidayCountdown {
  window: HolidayWindow;
  daysAway: number;
}

// 一天的农历 / 节日信息。没有的项写空串。
export interface ChineseCalendarDay {
  date: string;
  lunar?: LunarDate;
  // 当天的节日，农历节日在前。
  festivals: string[];
  // 目前只计算清明。
  solarTerm: string;
  // 当天属于哪个法定假期；空串表示不放假。
  holiday: string;
}

interface FestivalRule {
  month: number;
  day: number;
  name: string;
}

interface YearData {
  days: Map<string, ChineseCalendarDay>;
  holidays: HolidayWindow[];
}

const MONTH_NAMES: string[] = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];
const DAY_PREFIXES: string[] = ['初', '十', '廿', '卅'];
const DAY_DIGITS: string[] = ['十', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const HEAVENLY_STEMS: string[] = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const EARTHLY_BRANCHES: string[] = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
const ZODIACS: string[] = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪'];
const WEEKDAY_LABELS: string[] = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

// 七个法定节日的名字，服务端说明里认的就是这几个。
export const STATUTORY_HOLIDAY_NAMES: string[] = ['元旦', '春节', '清明节', '劳动节', '端午节', '中秋节', '国庆节'];

// 逐个写出来而不是机械地去掉「节」字：「劳动快乐」不成话；清明、端午按习惯道安康。
const HOLIDAY_GREETINGS: Map<string, string> = new Map<string, string>([
  ['元旦', '元旦快乐'], ['春节', '春节快乐'], ['清明节', '清明安康'], ['劳动节', '劳动节快乐'],
  ['端午节', '端午安康'], ['中秋节', '中秋快乐'], ['国庆节', '国庆快乐']
]);

// 农历节日。闰月不算节日。
const LUNAR_FESTIVALS: FestivalRule[] = [
  { month: 1, day: 1, name: '春节' }, { month: 1, day: 15, name: '元宵节' }, { month: 2, day: 2, name: '龙抬头' },
  { month: 5, day: 5, name: '端午节' }, { month: 7, day: 7, name: '七夕' }, { month: 7, day: 15, name: '中元节' },
  { month: 8, day: 15, name: '中秋节' }, { month: 9, day: 9, name: '重阳节' },
  { month: 12, day: 8, name: '腊八节' }, { month: 12, day: 23, name: '小年' }
];

// 公历节日。
const SOLAR_FESTIVALS: FestivalRule[] = [
  { month: 1, day: 1, name: '元旦' }, { month: 3, day: 8, name: '妇女节' }, { month: 3, day: 12, name: '植树节' },
  { month: 5, day: 1, name: '劳动节' }, { month: 5, day: 4, name: '青年节' }, { month: 6, day: 1, name: '儿童节' },
  { month: 7, day: 1, name: '建党节' }, { month: 8, day: 1, name: '建军节' }, { month: 9, day: 10, name: '教师节' },
  { month: 10, day: 1, name: '国庆节' }, { month: 12, day: 25, name: '圣诞节' }
];

function clamp(value: number, lower: number, upper: number): number {
  return Math.min(Math.max(value, lower), upper);
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : `${value}`;
}

// ---- 农历文字 ----

// 「正月」「闰四月」「腊月」。
export function lunarMonthLabel(lunar: LunarDate): string {
  return (lunar.isLeapMonth ? '闰' : '') + MONTH_NAMES[clamp(lunar.month, 1, 12) - 1] + '月';
}

// 「初一」「十五」「廿三」「三十」。
export function lunarDayLabel(lunar: LunarDate): string {
  const value = clamp(lunar.day, 1, 30);
  if (value === 10) return '初十';
  if (value === 20) return '二十';
  if (value === 30) return '三十';
  return DAY_PREFIXES[Math.min(Math.floor((value - 1) / 10), 3)] + DAY_DIGITS[value % 10];
}

// 日历格里的农历文字：初一显示月名，其余显示日名。
export function lunarShortLabel(lunar: LunarDate): string {
  return lunar.day === 1 ? lunarMonthLabel(lunar) : lunarDayLabel(lunar);
}

// 「正月初一」。
export function lunarFullLabel(lunar: LunarDate): string {
  return lunarMonthLabel(lunar) + lunarDayLabel(lunar);
}

// 「丙午马年」。
export function lunarYearLabel(lunar: LunarDate): string {
  const index = clamp(lunar.cyclicalYear, 1, 60) - 1;
  return HEAVENLY_STEMS[index % 10] + EARTHLY_BRANCHES[index % 12] + ZODIACS[index % 12] + '年';
}

// ---- 日期工具 ----

export function dayNumber(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return NaN;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const value = Date.UTC(year, month - 1, day);
  const check = new Date(value);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return NaN;
  return Math.round(value / 86400000);
}

// ICU 的中国农历（鸿蒙 @ohos.i18n、安卓 android.icu 用的都是它）在朔落在北京时间午夜前后的几个月
// 把初一算错一天，和国家授时中心、iOS 都对不上：2027 年春节晚一天、2030 年春节早一天。表里是这几段
// 日子的正确农历：`month` 月，从 `from` 这天的 `firstDay` 日起逐日往后数。2000–2100 年逐日和 iOS
// 比对得出（2057、2097 年那两处是 iOS 自己算错了，不收）。这几个月都不是闰月。
interface LunarOverride {
  from: string;
  to: string;
  month: number;
  firstDay: number;
}

const ICU_LUNAR_OVERRIDES: LunarOverride[] = [
  { from: '2012-08-17', to: '2012-09-15', month: 7, firstDay: 1 },
  { from: '2018-11-07', to: '2018-11-07', month: 9, firstDay: 30 },
  { from: '2018-11-08', to: '2018-12-06', month: 10, firstDay: 1 },
  { from: '2027-02-06', to: '2027-03-07', month: 1, firstDay: 1 },
  { from: '2030-02-02', to: '2030-02-02', month: 12, firstDay: 30 },
  { from: '2030-02-03', to: '2030-03-03', month: 1, firstDay: 1 },
  { from: '2070-03-12', to: '2070-04-10', month: 2, firstDay: 1 },
];

// 给 ICU 的农历换算套上上面的修正。
export function correctIcuLunar(resolver: LunarResolver): LunarResolver {
  return (date: string): LunarDate | undefined => {
    const value = dayNumber(date);
    for (const item of ICU_LUNAR_OVERRIDES) {
      const from = dayNumber(item.from);
      if (value < from || value > dayNumber(item.to)) continue;
      // 年份取这个月十五前后的一天：离 ICU 算错的月初月末都远，正月、腊月也不会串年。
      const reference = resolver(dateFromDayNumber(from + 15 - item.firstDay));
      if (!reference) return undefined;
      return { month: item.month, day: item.firstDay + value - from, isLeapMonth: false, cyclicalYear: reference.cyclicalYear };
    }
    return resolver(date);
  };
}

export function dateFromDayNumber(value: number): string {
  const date = new Date(value * 86400000);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

// start → end 相差几天；解析不了返回 NaN。
export function dayGap(start: string, end: string): number {
  return dayNumber(end) - dayNumber(start);
}

// 「9.25」。
export function monthDayLabel(date: string): string {
  const pieces = date.split('-');
  if (pieces.length !== 3) return date;
  const month = Number(pieces[1]);
  const day = Number(pieces[2]);
  if (!Number.isInteger(month) || !Number.isInteger(day)) return date;
  return `${month}.${day}`;
}

// 「周五」；解析不了返回空串。
export function weekdayLabel(date: string): string {
  const value = dayNumber(date);
  if (isNaN(value)) return '';
  // 1970-01-01 是周四。
  return WEEKDAY_LABELS[(((value + 4) % 7) + 7) % 7];
}

// ---- 放假安排 ----

// 从调休表的放假行里挑出法定假日：说明里提到哪个法定节日就算哪个，「国庆节、中秋节」取先出现的
// 「国庆节」。学校自己的停课（校运会之类）不算。
export function publishedHolidaysFromOffDays(days: OffDay[]): PublishedHoliday[] {
  const result: PublishedHoliday[] = [];
  days.forEach((day: OffDay) => {
    let best = '';
    let bestIndex = -1;
    STATUTORY_HOLIDAY_NAMES.forEach((name: string) => {
      const index = (day.note ?? '').indexOf(name);
      if (index >= 0 && (bestIndex < 0 || index < bestIndex)) {
        best = name;
        bestIndex = index;
      }
    });
    if (best) result.push({ date: day.date, name: best });
  });
  return result.sort((left: PublishedHoliday, right: PublishedHoliday) => compareText(left.date, right.date));
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

// 这段假期一共放几天（含首尾）。
export function windowDayCount(window: HolidayWindow): number {
  const gap = dayGap(window.start, window.end);
  return isNaN(gap) ? 1 : Math.max(1, gap + 1);
}

// ---- 倒计时文案 ----

// 「距中秋节还有」「今天是中秋节」。
export function countdownLeading(countdown: HolidayCountdown): string {
  return countdown.daysAway === 0 ? `今天是${countdown.window.name}` : `距${countdown.window.name}还有`;
}

// 「距国庆节还有 5 天」「今天是国庆节」。
export function countdownPhrase(countdown: HolidayCountdown): string {
  if (countdown.daysAway <= 0) return countdownLeading(countdown);
  return `${countdownLeading(countdown)} ${countdown.daysAway} 天`;
}

// 「9.25 周五」，连休则是「10.1 - 10.7 · 休 7 天」。
export function countdownDateLabel(countdown: HolidayCountdown): string {
  const window = countdown.window;
  const start = monthDayLabel(window.start);
  if (window.end === window.start) {
    const weekday = weekdayLabel(window.start);
    return weekday ? `${start} ${weekday}` : start;
  }
  return `${start} - ${monthDayLabel(window.end)} · 休 ${windowDayCount(window)} 天`;
}

// ---- 一天的信息 ----

// 只有节日/假期时才有值：法定假日 > 节日 > 节气。
export function calendarDayBadge(day: ChineseCalendarDay): string {
  return day.holiday || (day.festivals.length > 0 ? day.festivals[0] : '') || day.solarTerm;
}

// 小组件与日历格里那一行小字：法定假日 > 节日 > 节气 > 农历日期。
export function calendarDayLabel(day: ChineseCalendarDay): string {
  return calendarDayBadge(day) || (day.lunar ? lunarShortLabel(day.lunar) : '');
}

// 清明在 21 世纪前中段按四年一轮的 4/4、4/4、4/5、4/5 排列（只用于 2020—2043）。
export function qingmingDay(year: number): number {
  const remainder = ((year % 4) + 4) % 4;
  return remainder <= 1 ? 4 : 5;
}

// 一个农历换算器 + 一份服务端放假安排算出的节日与假期，按公历年整体算一次再缓存。
export class ChineseCalendar {
  private resolver: LunarResolver;
  private published: PublishedHoliday[];
  private years: Map<number, YearData> = new Map<number, YearData>();

  constructor(resolver: LunarResolver, published: PublishedHoliday[] = []) {
    this.resolver = correctIcuLunar(resolver);
    this.published = published
      .filter((item: PublishedHoliday) => !!item.name && !isNaN(dayNumber(item.date)))
      .sort((left: PublishedHoliday, right: PublishedHoliday) => compareText(left.date, right.date));
  }

  info(date: string): ChineseCalendarDay | undefined {
    const year = Number(date.substring(0, 4));
    if (!Number.isInteger(year) || isNaN(dayNumber(date))) return undefined;
    return this.year(year).days.get(date);
  }

  holidays(year: number): HolidayWindow[] {
    return this.year(year).holidays;
  }

  // 今天不上课时那句问候：法定假日说「中秋快乐」，其余返回空串，调用方改说「今日无课」。
  restGreeting(date: string): string {
    const holiday = this.info(date)?.holiday ?? '';
    if (!holiday) return '';
    return HOLIDAY_GREETINGS.get(holiday) ?? `${holiday}快乐`;
  }

  // 下一段法定假期（含今天所在的假期）；超过 limit 天返回 undefined。
  countdown(today: string, limit: number = 60): HolidayCountdown | undefined {
    const year = Number(today.substring(0, 4));
    if (!Number.isInteger(year) || isNaN(dayNumber(today))) return undefined;
    // 跨年的连休（元旦从 12.30 放起）两年里各有一份，去掉重复的。
    const seen: string[] = [];
    const windows: HolidayWindow[] = [];
    this.year(year).holidays.concat(this.year(year + 1).holidays).forEach((window: HolidayWindow) => {
      if (seen.includes(window.start)) return;
      seen.push(window.start);
      windows.push(window);
    });
    const next = windows.find((window: HolidayWindow) => window.end >= today);
    if (!next) return undefined;
    const start = next.start > today ? next.start : today;
    const days = dayGap(today, start);
    if (isNaN(days) || days > limit) return undefined;
    return { window: next, daysAway: days };
  }

  // 服务端放假日按「同名且日期相连」并成一段段假期，挑出和这一年沾边的。
  private publishedWindows(year: number): HolidayWindow[] {
    const windows: HolidayWindow[] = [];
    this.published.forEach((day: PublishedHoliday) => {
      const last = windows.length > 0 ? windows[windows.length - 1] : undefined;
      if (last && last.name === day.name && dayGap(last.end, day.date) === 1) {
        windows[windows.length - 1] = { name: last.name, start: last.start, end: day.date };
      } else if (!last || last.end !== day.date) {
        windows.push({ name: day.name, start: day.date, end: day.date });
      }
    });
    const prefix = `${year}-`;
    return windows.filter((window: HolidayWindow) => window.start.startsWith(prefix) || window.end.startsWith(prefix));
  }

  private year(year: number): YearData {
    const cached = this.years.get(year);
    if (cached) return cached;
    const built = this.build(year);
    this.years.set(year, built);
    if (this.years.size > 8) {
      let farthest = year;
      this.years.forEach((_value: YearData, key: number) => {
        if (Math.abs(key - year) > Math.abs(farthest - year)) farthest = key;
      });
      this.years.delete(farthest);
    }
    return built;
  }

  private build(year: number): YearData {
    const first = dayNumber(`${year}-01-01`);
    const last = dayNumber(`${year}-12-31`);
    const data: YearData = { days: new Map<string, ChineseCalendarDay>(), holidays: [] };
    if (isNaN(first) || isNaN(last)) return data;

    const dates: string[] = [];
    const lunarByDate: Map<string, LunarDate> = new Map<string, LunarDate>();
    const festivalsByDate: Map<string, string[]> = new Map<string, string[]>();
    const addFestival = (date: string, name: string, front: boolean) => {
      const list = festivalsByDate.get(date) ?? [];
      if (front) list.unshift(name); else list.push(name);
      festivalsByDate.set(date, list);
    };

    for (let value = first; value <= last; value += 1) {
      const key = dateFromDayNumber(value);
      dates.push(key);
      const lunar = this.resolver(key);
      if (lunar) {
        lunarByDate.set(key, lunar);
        if (!lunar.isLeapMonth) {
          const festival = LUNAR_FESTIVALS.find((rule: FestivalRule) => rule.month === lunar.month && rule.day === lunar.day);
          if (festival) addFestival(key, festival.name, false);
        }
      }
      const month = Number(key.substring(5, 7));
      const day = Number(key.substring(8, 10));
      const solar = SOLAR_FESTIVALS.find((rule: FestivalRule) => rule.month === month && rule.day === day);
      if (solar) addFestival(key, solar.name, false);
    }

    const qingming = `${year}-04-${pad2(qingmingDay(year))}`;
    const lunarDateOf = (month: number, day: number): string => {
      return dates.find((key: string) => {
        const lunar = lunarByDate.get(key);
        return lunar !== undefined && !lunar.isLeapMonth && lunar.month === month && lunar.day === day;
      }) ?? '';
    };

    // 除夕是正月初一的前一天，长短月都对：腊月可能只有廿九天。
    const springFestival = lunarDateOf(1, 1);
    let newYearEve = '';
    const springIndex = springFestival ? dates.indexOf(springFestival) : -1;
    if (springIndex > 0) {
      newYearEve = dates[springIndex - 1];
      addFestival(newYearEve, '除夕', true);
    }

    let holidays: HolidayWindow[] = [{ name: '元旦', start: `${year}-01-01`, end: `${year}-01-01` }];
    if (springFestival) {
      // 2024 年修订后的《全国年节及纪念日放假办法》：春节自除夕起放假 4 天。
      holidays.push({ name: '春节', start: newYearEve || springFestival, end: lunarDateOf(1, 3) || springFestival });
    }
    holidays.push({ name: '清明节', start: qingming, end: qingming });
    holidays.push({ name: '劳动节', start: `${year}-05-01`, end: `${year}-05-02` });
    const dragonBoat = lunarDateOf(5, 5);
    if (dragonBoat) holidays.push({ name: '端午节', start: dragonBoat, end: dragonBoat });
    const midAutumn = lunarDateOf(8, 15);
    if (midAutumn) holidays.push({ name: '中秋节', start: midAutumn, end: midAutumn });
    holidays.push({ name: '国庆节', start: `${year}-10-01`, end: `${year}-10-03` });
    const published = this.publishedWindows(year);
    if (published.length > 0) {
      // 服务端给了哪个节日就用哪个：同名的、以及被连休盖住的法定假日都让位
      // （2025 年中秋落在国庆连休里，服务端只写一段「国庆节、中秋节」）。
      const prefix = `${year}-`;
      holidays = holidays.filter((window: HolidayWindow) => !published.some((item: HolidayWindow) => {
        return (item.name === window.name && item.start.startsWith(prefix))
          || (item.start <= window.end && window.start <= item.end);
      }));
      holidays = holidays.concat(published);
    }
    holidays.sort((left: HolidayWindow, right: HolidayWindow) => compareText(left.start, right.start));

    const holidayByDate: Map<string, string> = new Map<string, string>();
    holidays.forEach((window: HolidayWindow) => {
      const end = dayNumber(window.end);
      for (let value = dayNumber(window.start); value <= end; value += 1) {
        const key = dateFromDayNumber(value);
        if (!holidayByDate.has(key)) holidayByDate.set(key, window.name);
      }
    });

    data.holidays = holidays;
    dates.forEach((key: string) => {
      data.days.set(key, {
        date: key,
        lunar: lunarByDate.get(key),
        festivals: festivalsByDate.get(key) ?? [],
        solarTerm: key === qingming ? '清明' : '',
        holiday: holidayByDate.get(key) ?? ''
      });
    });
    return data;
  }
}
