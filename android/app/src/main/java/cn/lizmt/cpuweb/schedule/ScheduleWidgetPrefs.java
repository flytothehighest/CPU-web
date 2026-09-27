package cn.lizmt.cpuweb.schedule;

import android.content.Context;
import android.content.SharedPreferences;

final class ScheduleWidgetPrefs {
    private static final String PREFS = "schedule_widget";
    private static final String KEY_ENDPOINT = "endpoint";
    private static final String KEY_THEME = "theme";

    private ScheduleWidgetPrefs() {
    }

    static void saveEndpoint(Context context, String endpoint) {
        prefs(context).edit().putString(KEY_ENDPOINT, endpoint).apply();
    }

    static String endpoint(Context context) {
        SharedPreferences preferences = prefs(context);
        String stored = preferences.getString(KEY_ENDPOINT, "");
        String normalized = ScheduleWidgetEndpoint.normalize(stored);
        if (!normalized.equals(stored)) {
            preferences.edit().putString(KEY_ENDPOINT, normalized).apply();
        }
        return normalized;
    }

    /** 课表主题（和网页端、iOS 同名的九套之一）。返回是否有变化。 */
    static boolean saveTheme(Context context, String theme) {
        String normalized = ScheduleWidgetPalette.normalizeTheme(theme);
        if (normalized.equals(theme(context))) return false;
        prefs(context).edit().putString(KEY_THEME, normalized).apply();
        return true;
    }

    static String theme(Context context) {
        return ScheduleWidgetPalette.normalizeTheme(prefs(context).getString(KEY_THEME, ScheduleWidgetPalette.DEFAULT_THEME));
    }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
