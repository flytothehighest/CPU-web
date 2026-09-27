// 课表卡片的配色，照 iOS ScheduleWidgets.swift 的 WidgetPalette 移植，数值一致：
// 同一门课在两个平台上是同一种颜色。
//
// 这里只有纯计算，卡片和 App 都能引用。深色模式的底色（强调色叠 18% 透明度）
// 写在 resources/dark/element/color.json 的 widget_tint_* 里，由系统按深浅色自动切换。

export const WIDGET_THEMES: string[] = ['green', 'blue', 'teal', 'indigo', 'violet', 'orange', 'rose', 'slate', 'color-glass'];

// 多彩主题的六种强调色和浅色底，按课程名散列取一种。
export const COLOR_GLASS_ACCENTS: string[] = ['#E85B4B', '#4A78F2', '#8B5CF6', '#17A69A', '#E0A224', '#EC70A1'];
export const COLOR_GLASS_TINTS: string[] = ['#FDECE9', '#EAF0FF', '#F2ECFF', '#E5F8F5', '#FFF7E0', '#FDEBF4'];

// 深色模式下课程块的底色：强调色叠 18% 不透明度（0.18 × 255 ≈ 0x2E）。
export const DARK_TINT_ALPHA: string = '2E';
// 「明天的课」和节日徽标的胶囊底：强调色叠 16%（0x29）。
export const CHIP_ALPHA: string = '29';

export function normalizedWidgetTheme(value?: string): string {
  const theme = (value ?? '').trim().toLowerCase();
  return WIDGET_THEMES.includes(theme) ? theme : 'color-glass';
}

// 主题色：日期栏的星期、「明天的课」胶囊、单色主题下每门课的色条。
export function widgetThemeAccent(theme: string): string {
  if (theme === 'green') return '#168776';
  if (theme === 'blue') return '#2563EB';
  if (theme === 'teal') return '#0891B2';
  if (theme === 'indigo') return '#DB2777';
  if (theme === 'violet') return '#7C3AED';
  if (theme === 'orange') return '#EA580C';
  if (theme === 'rose') return '#E11D48';
  if (theme === 'slate') return '#475569';
  return '#0F8F7F';
}

// 单色主题浅色模式下课程块的底色。
export function widgetThemeTint(theme: string): string {
  if (theme === 'green') return '#F4FBF8';
  if (theme === 'blue') return '#F3F8FF';
  if (theme === 'teal') return '#F0FBFF';
  if (theme === 'indigo') return '#FFF5FA';
  if (theme === 'violet') return '#FAF7FF';
  if (theme === 'orange') return '#FFF7F1';
  if (theme === 'rose') return '#FFF5F7';
  if (theme === 'slate') return '#F8FAFC';
  return COLOR_GLASS_TINTS[0];
}

// 与 iOS 相同的散列：按 Unicode 码点逐个 `hash * 31 + 码点`，保留低 31 位，再对 6 取余。
// hash 不超过 2^31，乘 31 加码点也在 2^53 以内，按位与之前不会丢精度。
export function widgetCourseColorIndex(name: string): number {
  let hash = 0;
  let index = 0;
  while (index < name.length) {
    const point = name.codePointAt(index) ?? 0;
    hash = (hash * 31 + point) & 0x7fffffff;
    index += point > 0xffff ? 2 : 1;
  }
  return hash % COLOR_GLASS_ACCENTS.length;
}

export function widgetCourseAccent(name: string, theme: string): string {
  return theme === 'color-glass' ? COLOR_GLASS_ACCENTS[widgetCourseColorIndex(name)] : widgetThemeAccent(theme);
}

// 课程块底色。浅色用各自的浅底；深色一律是该课强调色叠 18%，#AARRGGBB。
export function widgetCourseTint(name: string, theme: string, dark: boolean): string {
  if (dark) return `#${DARK_TINT_ALPHA}${widgetCourseAccent(name, theme).substring(1)}`;
  return theme === 'color-glass' ? COLOR_GLASS_TINTS[widgetCourseColorIndex(name)] : widgetThemeTint(theme);
}

// 胶囊底色：强调色叠 16%，深浅色模式通用。
export function widgetChipFill(accent: string): string {
  return accent.length === 7 ? `#${CHIP_ALPHA}${accent.substring(1)}` : accent;
}
