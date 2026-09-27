import i18n from '@ohos.i18n';
import { LunarDate } from './ChineseCalendar';

// 系统自带的中国农历历法（ICU chinese 日历）：year 是六十甲子序号 1...60，month 从 0 起，
// is_leap_month 为 1 表示闰月。只在这里碰 @ohos.i18n，其余农历逻辑都在 ChineseCalendar.ets。
let lunarCalendar: i18n.Calendar | undefined = undefined;

function calendar(): i18n.Calendar {
  if (lunarCalendar) return lunarCalendar;
  const created = i18n.getCalendar('zh-Hans-CN', 'chinese');
  created.setTimeZone('Asia/Shanghai');
  lunarCalendar = created;
  return created;
}

export function systemLunarDate(date: string): LunarDate | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return undefined;
  try {
    const value = calendar();
    // 取北京时间正午（UTC 04:00），离换日最远。
    value.setTime(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 4, 0, 0));
    const month = value.get('month') + 1;
    const day = value.get('date');
    const cyclicalYear = value.get('year');
    if (month < 1 || month > 12 || day < 1 || day > 30 || cyclicalYear < 1 || cyclicalYear > 60) return undefined;
    return { month, day, isLeapMonth: value.get('is_leap_month') === 1, cyclicalYear };
  } catch (_) {
    return undefined;
  }
}
