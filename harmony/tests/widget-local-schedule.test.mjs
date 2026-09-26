import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { transformSync } = require('esbuild');

// 编译一个 .ets 模块，相对路径的 import 也按真实源码编译，系统模块从 mocks 取。
function compileTree(path, mocks = {}, globals = {}, cache = new Map()) {
  const url = new URL(path, import.meta.url);
  if (cache.has(url.href)) return cache.get(url.href);
  const source = readFileSync(url, 'utf8').replace('@Observed', '');
  const context = vm.createContext({ module: { exports: {} }, ...globals, require: id => {
    if (id in mocks) return mocks[id];
    if (id.startsWith('.')) return compileTree(new URL(`${id}.ets`, url).href, mocks, globals, cache);
    throw Error('unexpected import ' + id);
  } });
  vm.runInContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, context);
  cache.set(url.href, context.module.exports);
  return context.module.exports;
}

// 用 Node 自带的 ICU 农历代替 @ohos.i18n。
const lunarFormat = new Intl.DateTimeFormat('en-u-ca-chinese', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric', day: 'numeric' });
function intlParts(time) {
  const parts = lunarFormat.formatToParts(new Date(time));
  const part = type => parts.find(item => item.type === type).value;
  const related = Number(part('relatedYear'));
  return { month: parseInt(part('month'), 10), day: Number(part('day')), leap: /bis/.test(part('month')),
    cyclicalYear: ((related - 4) % 60 + 60) % 60 + 1 };
}
function intlLunar(date) {
  const [year, month, day] = date.split('-').map(Number);
  const value = intlParts(Date.UTC(year, month - 1, day, 4));
  return { month: value.month, day: value.day, isLeapMonth: value.leap, cyclicalYear: value.cyclicalYear };
}

const calendarModule = compileTree('../entry/src/main/ets/common/ChineseCalendar.ets');
const calendar = (published = []) => new calendarModule.ChineseCalendar(intlLunar, published);

test('fromOffDays keeps statutory holidays only and takes the first name mentioned', () => {
  const holidays = calendarModule.publishedHolidaysFromOffDays([
    { date: '2025-10-02', note: '国庆节、中秋节' }, { date: '2025-10-01', note: '国庆节、中秋节放假' },
    { date: '2026-09-25', note: '中秋节' }, { date: '2026-11-05', note: '校运会停课' }, { date: '2026-11-06', note: '' }
  ]);
  assert.deepEqual([...holidays.map(item => `${item.date}:${item.name}`)],
    ['2025-10-01:国庆节', '2025-10-02:国庆节', '2026-09-25:中秋节']);
});

test('lunar labels, leap months and the cyclical year match iOS', () => {
  const c = calendar();
  const midAutumn = c.info('2026-09-25');
  assert.equal(calendarModule.lunarShortLabel(midAutumn.lunar), '十五');
  assert.equal(calendarModule.lunarFullLabel(midAutumn.lunar), '八月十五');
  assert.equal(calendarModule.lunarYearLabel(midAutumn.lunar), '丙午马年');
  assert.equal(calendarModule.lunarShortLabel(c.info('2026-02-17').lunar), '正月');
  assert.equal(calendarModule.lunarShortLabel(c.info('2025-07-25').lunar), '闰六月');
  assert.equal(calendarModule.lunarDayLabel({ month: 1, day: 20, isLeapMonth: false, cyclicalYear: 1 }), '二十');
  assert.equal(calendarModule.lunarDayLabel({ month: 1, day: 23, isLeapMonth: false, cyclicalYear: 1 }), '廿三');
  assert.equal(calendarModule.lunarDayLabel({ month: 1, day: 10, isLeapMonth: false, cyclicalYear: 1 }), '初十');
  assert.equal(calendarModule.lunarDayLabel({ month: 1, day: 30, isLeapMonth: false, cyclicalYear: 1 }), '三十');
});

test('ICU late new moons are corrected: 2027 and 2030 Spring Festival fall on 2.6 and 2.3', () => {
  const c = calendar();
  assert.equal(c.info('2027-02-06').festivals[0], '春节');
  assert.equal(c.info('2027-02-05').festivals[0], '除夕');
  assert.equal(calendarModule.lunarFullLabel(c.info('2027-02-05').lunar), '腊月廿九');
  assert.equal(calendarModule.lunarFullLabel(c.info('2027-03-07').lunar), '正月三十');
  assert.equal(calendarModule.lunarFullLabel(c.info('2027-03-08').lunar), '二月初一');
  assert.equal(c.info('2027-02-06').lunar.cyclicalYear, c.info('2027-02-07').lunar.cyclicalYear);
  assert.equal(calendarModule.lunarFullLabel(c.info('2030-02-03').lunar), '正月初一');
  assert.equal(calendarModule.lunarFullLabel(c.info('2030-02-02').lunar), '腊月三十');
});

test('festivals, qingming and the badge priority holiday > festival > solar term > lunar', () => {
  const c = calendar();
  const eve = c.info('2026-02-16');
  assert.deepEqual([...eve.festivals], ['除夕']); assert.equal(eve.holiday, '春节');
  assert.equal(calendarModule.calendarDayBadge(eve), '春节');
  // 2024 年修订：春节自除夕起放 4 天，到正月初三。
  assert.deepEqual({ ...c.holidays(2026).find(item => item.name === '春节') }, { name: '春节', start: '2026-02-16', end: '2026-02-19' });
  const lantern = c.info('2026-03-03');
  assert.equal(lantern.holiday, ''); assert.equal(calendarModule.calendarDayBadge(lantern), '元宵节');
  const qingming = c.info('2026-04-05');
  assert.equal(qingming.solarTerm, '清明'); assert.equal(calendarModule.calendarDayBadge(qingming), '清明节');
  assert.equal(calendarModule.qingmingDay(2024), 4); assert.equal(calendarModule.qingmingDay(2027), 5);
  assert.equal(calendarModule.calendarDayBadge({ date: 'x', festivals: [], solarTerm: '清明', holiday: '' }), '清明');
  const plain = c.info('2026-09-26');
  assert.equal(calendarModule.calendarDayBadge(plain), '');
  assert.equal(calendarModule.calendarDayLabel(plain), '十六');
  assert.deepEqual([...c.info('2026-10-01').festivals], ['国庆节']);
  assert.equal(c.info('2026-06-19').holiday, '端午节');
});

test('published holidays override same-name and overlapped offline holidays', () => {
  const published = calendarModule.publishedHolidaysFromOffDays(
    ['01', '02', '03', '04', '05', '06', '07', '08'].map(day => ({ date: `2025-10-${day}`, note: '国庆节、中秋节' })));
  const c = calendar(published);
  const holidays = c.holidays(2025).map(item => `${item.name}:${item.start}-${item.end}`);
  assert.ok(holidays.includes('国庆节:2025-10-01-2025-10-08'));
  assert.ok(!holidays.some(item => item.startsWith('中秋节')));
  const midAutumn = c.info('2025-10-06');
  assert.equal(midAutumn.holiday, '国庆节'); assert.ok(midAutumn.festivals.includes('中秋节'));
  assert.equal(c.restGreeting('2025-10-06'), '国庆快乐');
  // 没有发布的节日照旧离线推算。
  assert.ok(holidays.includes('劳动节:2025-05-01-2025-05-02'));
});

test('countdown text, limits, greetings and cross-year windows follow iOS', () => {
  const c = calendar();
  const national = c.countdown('2026-09-26', 120);
  assert.equal(national.daysAway, 5);
  assert.equal(calendarModule.countdownPhrase(national), '距国庆节还有 5 天');
  assert.equal(calendarModule.countdownDateLabel(national), '10.1 - 10.3 · 休 3 天');
  const midAutumn = c.countdown('2026-09-20', 120);
  assert.equal(calendarModule.countdownPhrase(midAutumn), '距中秋节还有 5 天');
  assert.equal(calendarModule.countdownDateLabel(midAutumn), '9.25 周五');
  const today = c.countdown('2026-10-02', 120);
  assert.equal(today.daysAway, 0); assert.equal(calendarModule.countdownPhrase(today), '今天是国庆节');
  assert.equal(c.countdown('2026-06-20', 60), undefined);
  assert.equal(c.countdown('2026-06-20', 120).window.name, '中秋节');
  assert.equal(c.restGreeting('2026-06-19'), '端午安康');
  assert.equal(c.restGreeting('2026-04-05'), '清明安康');
  assert.equal(c.restGreeting('2026-05-02'), '劳动节快乐');
  assert.equal(c.restGreeting('2026-09-26'), '');
  const newYear = calendar([{ date: '2026-12-31', name: '元旦' }, { date: '2027-01-01', name: '元旦' }]);
  const crossing = newYear.countdown('2026-12-30', 120);
  assert.deepEqual([crossing.window.start, crossing.window.end, crossing.daysAway], ['2026-12-31', '2027-01-01', 1]);
  assert.equal(calendarModule.countdownDateLabel(crossing), '12.31 - 1.1 · 休 2 天');
});

test('a missing lunar resolver still yields solar festivals and fixed holidays', () => {
  const c = new calendarModule.ChineseCalendar(() => undefined, []);
  const day = c.info('2026-10-01');
  assert.equal(day.lunar, undefined); assert.equal(calendarModule.calendarDayBadge(day), '国庆节');
  assert.equal(c.holidays(2026).some(item => item.name === '中秋节'), false);
});

test('the system lunar calendar reads ICU fields from @ohos.i18n', () => {
  const calls = [];
  let time = 0;
  const i18n = { getCalendar: (locale, type) => {
    calls.push(`${locale}|${type}`);
    return { setTimeZone: zone => calls.push(zone), setTime: value => { time = value; },
      get: field => {
        const value = intlParts(time);
        return { year: value.cyclicalYear, month: value.month - 1, date: value.day, is_leap_month: value.leap ? 1 : 0 }[field];
      } };
  } };
  const lunar = compileTree('../entry/src/main/ets/common/SystemLunarCalendar.ets', { '@ohos.i18n': i18n });
  assert.deepEqual({ ...lunar.systemLunarDate('2025-07-25') }, { month: 6, day: 1, isLeapMonth: true, cyclicalYear: 42 });
  assert.deepEqual({ ...lunar.systemLunarDate('2026-09-25') }, { month: 8, day: 15, isLeapMonth: false, cyclicalYear: 43 });
  assert.equal(lunar.systemLunarDate('bad'), undefined);
  assert.deepEqual(calls, ['zh-Hans-CN|chinese', 'Asia/Shanghai']);
  const broken = compileTree('../entry/src/main/ets/common/SystemLunarCalendar.ets', { '@ohos.i18n': { getCalendar: () => { throw Error('no icu'); } } });
  assert.equal(broken.systemLunarDate('2026-09-25'), undefined);
});

// ---- 本地课表 ----

const storeModule = compileTree('../entry/src/main/ets/schedule/NativeScheduleStore.ets');
const localModule = compileTree('../entry/src/main/ets/schedule/NativeWidgetLocalSchedule.ets');
const store = new storeModule.NativeScheduleStore();
const blocks = (cells, day, week) => store.blocksInWeek(cells, day, week);
const weekDays = start => Array.from({ length: 7 }, (_, index) => `2026-09-${String(start + index).padStart(2, '0')}`);

function termSnapshot({ complete = true, week = '2', semester = '2026-2027-1', cells, adjustments } = {}) {
  return {
    version: 1, completeSemester: complete, auth: { authenticated: true },
    periods: [{ number: 1, startTime: '08:00', endTime: '08:45' }, { number: 2, startTime: '08:55', endTime: '09:40' },
      { number: 3, startTime: '10:00', endTime: '10:45' }, { number: 4, startTime: '10:55', endTime: '11:40' }],
    data: { currentSemester: semester, currentWeek: week, semesters: [], weeks: [],
      cells: cells ?? [
        { day: 1, bigSlot: 1, courses: [{ name: '药理学', teacher: '王老师', location: 'A101', weeks: '1-2周', weekList: [1, 2] }] },
        { day: 3, bigSlot: 2, courses: [{ name: '有机化学', weeks: '2周', weekList: [2], slotNote: '' }] },
        { day: 5, bigSlot: 1, courses: [{ name: '讲座', weeks: '1-16周', weekList: [], customStartTime: '07:30', customEndTime: '08:10' }] }
      ] },
    calendar: { currentWeek: 2, semesterStart: '2026-09-07', semesterEnd: '2027-01-17',
      weeks: [{ week: 1, days: weekDays(7), monday: '2026-09-07', sunday: '2026-09-13' },
        { week: 2, days: weekDays(14), monday: '2026-09-14', sunday: '2026-09-20' }],
      adjustments: adjustments ?? [
        { date: '2026-09-14', kind: 'off', note: '国庆节、中秋节' },
        { date: '2026-09-15', kind: 'off', note: '校运会' },
        { date: '2026-09-19', kind: 'swap', source: '2026-09-16', note: '补 9.16 的课' },
        { date: '2026-09-20', kind: 'swap', source: '2026-12-31' }
      ] }
  };
}
const plain = value => JSON.parse(JSON.stringify(value));

test('a complete term expands to dated days with off and swap adjustments', () => {
  const record = plain(localModule.localScheduleRecord(termSnapshot(), blocks));
  assert.equal(record.semester, '2026-2027-1');
  assert.deepEqual(record.days.map(day => day.date), [...weekDays(7), ...weekDays(14)]);
  const monday = record.days.find(day => day.date === '2026-09-07');
  assert.deepEqual([monday.day, monday.label, monday.week], [1, '周一', 1]);
  assert.deepEqual(monday.courses, [{ name: '药理学', teacher: '王老师', location: 'A101', note: '01-02节', slotNote: '01-02节',
    startTime: '08:00', endTime: '08:45', startSlot: 1, endSlot: 2 }].map(course => ({ ...course, endTime: '09:40' })));
  assert.deepEqual(record.days.find(day => day.date === '2026-09-11').courses.map(course => [course.startTime, course.endTime]), [['07:30', '08:10']]);
  // 放假：明确没课，学校停课也一样。
  assert.deepEqual(record.days.find(day => day.date === '2026-09-14').courses, []);
  assert.deepEqual(record.days.find(day => day.date === '2026-09-15').courses, []);
  // 补课：周六上周三的课，星期和周次仍按这一天写。
  const saturday = record.days.find(day => day.date === '2026-09-19');
  assert.deepEqual([saturday.day, saturday.label, saturday.week], [6, '周六', 2]);
  assert.deepEqual(saturday.courses.map(course => [course.name, course.startTime]), [['有机化学', '10:00']]);
  // 被补的日子不在周历里：按放假处理。
  assert.deepEqual(record.days.find(day => day.date === '2026-09-20').courses, []);
  // 第 1 周没有有机化学。
  assert.deepEqual(record.days.find(day => day.date === '2026-09-09').courses, []);
  assert.deepEqual(record.holidays, [{ date: '2026-09-14', name: '国庆节' }]);
});

test('weekdays come from the date even when the calendar week starts on Sunday', () => {
  const snapshot = termSnapshot({ adjustments: [] });
  snapshot.calendar.weeks = [{ week: 1, days: ['2026-09-06', ...weekDays(7).slice(0, 6)], monday: '2026-09-07', sunday: '2026-09-06' }];
  const record = localModule.localScheduleRecord(snapshot, blocks);
  const sunday = record.days.find(day => day.date === '2026-09-06');
  assert.deepEqual([sunday.day, sunday.label], [7, '周日']);
  assert.equal(record.days.find(day => day.date === '2026-09-07').courses[0].name, '药理学');
});

test('a week-only snapshot replaces only its week and keeps the rest of the same term', () => {
  const existing = plain(localModule.localScheduleRecord(termSnapshot(), blocks));
  const weekly = termSnapshot({ complete: false, week: '2', adjustments: [],
    cells: [{ day: 2, bigSlot: 2, courses: [{ name: '生理学', weeks: '2周', weekList: [2] }] }] });
  const merged = plain(localModule.localScheduleRecord(weekly, blocks, existing));
  assert.equal(merged.days.length, 14);
  assert.equal(merged.days.find(day => day.date === '2026-09-07').courses[0].name, '药理学');
  assert.deepEqual(merged.days.find(day => day.date === '2026-09-15').courses.map(course => course.name), ['生理学']);
  assert.deepEqual(merged.days.find(day => day.date === '2026-09-14').courses, []);
  // 这一份没带调休表：沿用上一份的放假安排。
  assert.deepEqual(merged.holidays, [{ date: '2026-09-14', name: '国庆节' }]);
  const other = plain(localModule.localScheduleRecord({ ...weekly, data: { ...weekly.data, currentSemester: '2026-2027-2' } }, blocks, existing));
  assert.equal(other.days.length, 7); assert.deepEqual(other.holidays, []);
  // 整学期的快照整份覆盖。
  const replaced = plain(localModule.localScheduleRecord({ ...termSnapshot({ adjustments: [] }), calendar: { ...weekly.calendar, weeks: weekly.calendar.weeks.slice(1) } }, blocks, existing));
  assert.equal(replaced.days.length, 7);
});

test('snapshots without dates or a usable week produce no record', () => {
  assert.equal(localModule.localScheduleRecord({ ...termSnapshot(), calendar: undefined }, blocks), undefined);
  assert.equal(localModule.localScheduleRecord(termSnapshot({ complete: false, week: '' }), blocks), undefined);
  assert.equal(localModule.localScheduleRecord(termSnapshot({ semester: '' }), blocks), undefined);
});

test('the store reports authenticated snapshots and clears on logout or account change', () => {
  let now = Date.now();
  class Clock extends Date { static now() { return now; } }
  const module = compileTree('../entry/src/main/ets/schedule/NativeScheduleStore.ets', {},
    { Date: Clock, setTimeout: () => 1, clearTimeout: () => {} }, new Map());
  const live = new module.NativeScheduleStore();
  const requests = []; const seen = [];
  live.attach(request => requests.push(request), () => {});
  live.attachSnapshotListener(snapshot => seen.push(snapshot ? snapshot.data.currentWeek : 'cleared'));
  live.markBridgeReady();
  live.acceptResult(requests.at(-1).id, JSON.stringify({ ...termSnapshot({ complete: false }), fetchedAt: now }));
  live.acceptResult(requests.at(-1).id, JSON.stringify({ version: 1, auth: { authenticated: true }, error: 'offline' }));
  live.handleAuthChanged('user-2');
  live.acceptResult(requests.at(-1).id, JSON.stringify({ version: 1, auth: { authenticated: false } }));
  assert.deepEqual(seen, ['2', 'cleared', 'cleared']);
});

// ---- 卡片读本地课表 ----

function memoryFs() {
  const files = new Map();
  const missing = path => { if (!files.has(path)) throw Error('ENOENT ' + path); };
  return { files, OpenMode: { CREATE: 1, READ_WRITE: 2, TRUNC: 4 },
    statSync: path => { missing(path); return { size: Buffer.byteLength(files.get(path)) }; },
    readTextSync: path => { missing(path); return files.get(path); },
    openSync: path => ({ fd: path }), writeSync: (fd, raw) => files.set(fd, raw), closeSync: () => {},
    renameSync: (from, to) => { missing(from); files.set(to, files.get(from)); files.delete(from); },
    unlinkSync: path => { missing(path); files.delete(path); } };
}

function serviceHarness(nowValue) {
  const values = new Map(); const updates = []; let fetches = 0;
  let now = nowValue;
  class Clock extends Date { static now() { return now; } }
  const prefs = { get: async (key, fallback) => values.has(key) ? values.get(key) : fallback,
    put: async (key, value) => { values.set(key, value); }, delete: async key => { values.delete(key); }, flush: async () => {} };
  const fs = memoryFs();
  const payload = { title: '服务端课表', currentWeek: 2, strictDate: true,
    today: { label: '周二', date: '2026-09-15', courses: [{ name: '服务端课程', startTime: '20:30', endTime: '21:00' }] } };
  const mocks = {
    '@ohos.data.preferences': { getPreferences: async () => prefs, removePreferencesFromCache: async () => {} },
    '@ohos.file.fs': fs,
    '@ohos.net.http': { RequestMethod: { GET: 0 }, HttpDataType: { STRING: 0 }, createHttp: () => ({
      request: async () => { fetches += 1; return { responseCode: 200, result: JSON.stringify({ code: 0, data: payload }) }; }, destroy() {} }) },
    '@kit.FormKit': { formBindingData: { createFormBindingData: x => x }, formProvider: {
      updateForm: async (id, binding) => updates.push({ id, ...binding }), setFormNextRefreshTime: async () => {} } },
    './SystemLunarCalendar': { systemLunarDate: intlLunar },
  };
  const service = compileTree('../entry/src/main/ets/common/ScheduleWidgetService.ets', mocks, { Date: Clock }, new Map());
  return { service, values, updates, fs, fetches: () => fetches, setNow: value => { now = value; } };
}
const context = { filesDir: '/app/files' };
const localPath = '/app/files/schedule-widget-local-days.json';
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

test('cards read the local schedule first and never call the widget endpoint', async () => {
  const h = serviceHarness(new Date(2026, 8, 16, 7).getTime());
  await h.service.registerScheduleForm(context, 'card', 3, 'schedule_today');
  await h.service.saveScheduleWidgetConfiguration(context, JSON.stringify({ endpoint: 'https://cputime.cn/api/jwxt/schedule-widget/A' }));
  await h.service.saveLocalScheduleSnapshot(context, termSnapshot(), blocks); await flush();
  assert.ok(h.fs.files.has(localPath));
  const record = JSON.parse(h.fs.files.get(localPath));
  assert.deepEqual(Object.keys(record), ['semester', 'days', 'holidays']);
  // 写完就刷新了已添加的卡片。
  assert.equal(h.updates.at(-1).id, 'card');
  const value = h.updates.at(-1);
  assert.equal(value.state, 'ready'); assert.equal(h.fetches(), 0);
  assert.deepEqual(JSON.parse(value.primaryCourses).map(row => row.name), ['有机化学']);
  assert.equal(value.primaryWeek, 2); assert.equal(value.lunar, '初六');
  // 9.19 补 9.16 的课：从周五晚上看，下一次课就是周六。
  h.setNow(new Date(2026, 8, 18, 21).getTime());
  await h.service.refreshScheduleForm(context, 'card', 3, 'schedule_upcoming');
  assert.equal(h.updates.at(-1).dayNote, '明天的课');
  assert.deepEqual(JSON.parse(h.updates.at(-1).primaryCourses).map(row => row.name), ['有机化学']);
  assert.equal(h.fetches(), 0);
  assert.equal((await h.service.readScheduleWidgetSettings(context)).configured, true);
});

test('the local holidays drive the rest state and the header badge', async () => {
  const h = serviceHarness(new Date(2026, 8, 14, 9).getTime());
  await h.service.saveLocalScheduleSnapshot(context, termSnapshot(), blocks);
  await h.service.refreshScheduleForm(context, 'card', 3, 'schedule_upcoming');
  const value = h.updates.at(-1);
  // 调休表把 9.14 写成国庆节放假（测试数据），盖过离线推算。
  assert.equal(value.badge, '国庆节'); assert.equal(value.badgeStatutory, true);
  assert.equal(value.restTitle, '国庆快乐'); assert.equal(value.lockLine, '国庆快乐');
});

test('clearing the local schedule falls back to the endpoint, and nothing is written for a signed-out snapshot', async () => {
  const h = serviceHarness(new Date(2026, 8, 15, 7).getTime());
  await h.service.saveScheduleWidgetConfiguration(context, JSON.stringify({ endpoint: 'https://cputime.cn/api/jwxt/schedule-widget/A' }));
  await h.service.saveLocalScheduleSnapshot(context, { ...termSnapshot(), auth: { authenticated: false } }, blocks);
  assert.equal(h.fs.files.has(localPath), false);
  await h.service.saveLocalScheduleSnapshot(context, termSnapshot(), blocks);
  const revision = h.values.get('local_revision');
  // 内容没变不重写。
  await h.service.saveLocalScheduleSnapshot(context, termSnapshot(), blocks);
  assert.equal(h.values.get('local_revision'), revision);
  await h.service.saveLocalScheduleSnapshot(context, undefined, blocks);
  assert.equal(h.fs.files.has(localPath), false);
  await h.service.refreshScheduleForm(context, 'card', 3, 'schedule_today');
  assert.equal(h.fetches(), 1);
  assert.deepEqual(JSON.parse(h.updates.at(-1).primaryCourses).map(row => row.name), ['服务端课程']);
});

test('clearing the widget account deletes the local schedule', async () => {
  const h = serviceHarness(new Date(2026, 8, 15, 7).getTime());
  await h.service.saveLocalScheduleSnapshot(context, termSnapshot(), blocks);
  assert.ok(h.fs.files.has(localPath));
  await h.service.clearScheduleWidgetAccount(context);
  assert.equal(h.fs.files.has(localPath), false);
  await h.service.refreshScheduleForm(context, 'card', 3, 'schedule_today');
  assert.equal(h.updates.at(-1).state, 'unconfigured');
  assert.equal((await h.service.readScheduleWidgetSettings(context)).configured, false);
});
