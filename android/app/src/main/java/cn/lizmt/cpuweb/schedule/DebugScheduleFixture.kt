package cn.lizmt.cpuweb.schedule

import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar
import java.util.Locale

/**
 * Debug-only timetable, the counterpart of iOS `CPU_DEBUG_MOCK_SCHEDULE`.
 * Start a debug build with `--ez debugMockSchedule true` to inspect the
 * native grid, overlaps and long room names without a school session.
 */
object DebugScheduleFixture {
    const val EXTRA = "debugMockSchedule"
    private const val SEMESTER = "2026-2027-1"

    /** A complete term whose week 4 is the current week. */
    fun snapshot(): String {
        val calendar = Calendar.getInstance()
        val weekday = calendar.get(Calendar.DAY_OF_WEEK)
        calendar.add(Calendar.DAY_OF_YEAR, if (weekday == Calendar.SUNDAY) -6 else Calendar.MONDAY - weekday)
        val weeks = JSONArray()
        val base = calendar.clone() as Calendar
        base.add(Calendar.DAY_OF_YEAR, -21)
        for (number in 1..18) {
            val days = JSONArray()
            for (offset in 0 until 7) {
                val day = base.clone() as Calendar
                day.add(Calendar.DAY_OF_YEAR, (number - 1) * 7 + offset)
                days.put(String.format(Locale.US, "%04d-%02d-%02d", day.get(Calendar.YEAR), day.get(Calendar.MONTH) + 1, day.get(Calendar.DAY_OF_MONTH)))
            }
            weeks.put(JSONObject().put("week", number).put("days", days).put("monday", days.getString(0)).put("sunday", days.getString(6)))
        }
        fun course(name: String, start: Int, end: Int, location: String, teacher: String, list: List<Int>) = JSONObject()
            .put("name", name).put("startSlot", start).put("endSlot", end).put("location", location).put("teacher", teacher)
            .put("weeks", ScheduleStore.weekText(list)).put("weekList", JSONArray(list)).put("sourceKey", "debug|$name|$start")
        val all = (1..18).toList()
        val odd = all.filter { it % 2 == 1 }
        fun cell(day: Int, slot: Int, vararg courses: JSONObject) =
            JSONObject().put("day", day).put("bigSlot", slot).put("courses", JSONArray(courses.toList()))
        val cells = JSONArray()
            .put(cell(1, 1, course("药理学", 1, 2, "药学楼 302", "王老师", all)))
            .put(cell(1, 3, course("有机化学实验", 5, 7, "艺术固定教室 YS403", "李老师", odd)))
            .put(cell(2, 2, course("大学英语 III", 3, 4, "文科楼 A201", "陈老师", all)))
            .put(cell(3, 1, course("生物化学", 1, 2, "药学楼 105", "周老师", all), course("体育（羽毛球）", 1, 2, "体育馆", "赵老师", all)))
            .put(cell(4, 3, course("药物分析", 5, 6, "实验楼 201", "孙老师", all)))
            .put(cell(5, 5, course("形势与政策", 9, 10, "图书馆报告厅", "吴老师", odd)))
            .put(cell(6, 2, course("周末选修：中药鉴定", 3, 4, "中药标本馆", "郑老师", all)))
        return JSONObject()
            .put("version", 1).put("source", "jwxt").put("completeSemester", true).put("fetchedAt", System.currentTimeMillis())
            .put("data", JSONObject()
                .put("currentSemester", SEMESTER).put("currentWeek", "4")
                .put("semesters", JSONArray().put(JSONObject().put("value", SEMESTER).put("label", "2026-2027 学年第一学期").put("current", true)))
                .put("weeks", JSONArray(all.map { JSONObject().put("value", "$it").put("label", "第${it}周").put("current", it == 4) }))
                .put("cells", cells))
            .put("calendar", JSONObject().put("currentWeek", 4).put("currentSemester", SEMESTER).put("weeks", weeks))
            .put("auth", JSONObject().put("authenticated", true).put("account", "debug"))
            .toString()
    }
}
