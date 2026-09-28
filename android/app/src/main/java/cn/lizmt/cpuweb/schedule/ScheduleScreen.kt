package cn.lizmt.cpuweb.schedule

import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.runtime.CompositionLocalProvider
import android.os.Build
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.NearMe
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.material.icons.rounded.ArrowDropDown
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material.icons.rounded.MoreHoriz
import androidx.compose.material.icons.rounded.MyLocation
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.lifecycleScope
import kotlin.math.max
import kotlinx.coroutines.flow.drop

/** Sheets presented over the timetable. */
sealed interface ScheduleSheet {
    data class Detail(val block: CourseBlock) : ScheduleSheet
    data class Overlap(val blocks: List<CourseBlock>) : ScheduleSheet
    data object WeekPicker : ScheduleSheet
    data object Style : ScheduleSheet
    data object Widgets : ScheduleSheet
    data object Editor : ScheduleSheet
    data object Appearance : ScheduleSheet
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NativeScheduleScreen(activity: MainActivity) {
    val store = activity.schedule
    val style = activity.style
    val colors = LocalScheduleColors.current
    var sheet by remember { mutableStateOf<ScheduleSheet?>(null) }
    val editor = remember { CourseEditorModel(activity.web, activity.lifecycleScope) { store.load(true) } }
    // A widget or link opening the timetable lands on the grid, not on a sheet left open.
    val openRequests = store.openRequests
    val handledOpen = remember { intArrayOf(openRequests) }
    LaunchedEffect(openRequests) {
        if (openRequests != handledOpen[0]) {
            handledOpen[0] = openRequests
            if (sheet != ScheduleSheet.Editor || !editor.busy) sheet = null
        }
    }

    fun openEditor(block: CourseBlock?, day: Int? = null, slot: Int? = null) {
        if (store.result == null || store.isGraduate) {
            activity.toast("请先加载本科课表，研究生课表暂不支持个人修改")
            return
        }
        editor.open(store, block)
        if (day != null && slot != null) editor.prefill(day, slot)
        sheet = ScheduleSheet.Editor
    }

    fun openCourse(block: CourseBlock, week: String) {
        val matches = store.overlapping(block, week)
        sheet = if (matches.size <= 1) ScheduleSheet.Detail(block) else ScheduleSheet.Overlap(matches)
    }

    // Over a background photo, header text sits on frosted plates like the iOS glass.
    val glass = if (style.background != null) colors.surface.copy(alpha = if (colors.dark) 0.7f else 0.78f) else null
    Box(Modifier.fillMaxSize().consumesTouches().background(colors.page)) {
        ScheduleBackground(style)
        CompositionLocalProvider(LocalScheduleGlass provides glass) {
        Column(Modifier.fillMaxSize().padding(start = 10.dp, end = 10.dp, top = 4.dp)) {
            // A term that failed to load has no weeks, but its picker must stay
            // reachable so another term can be chosen.
            if (store.weekOptions().isNotEmpty() || store.semesterOptions().isNotEmpty()) {
                ScheduleToolbar(
                    store = store,
                    onRefresh = { store.load(true) },
                    onStyle = { sheet = ScheduleSheet.Style },
                    onTools = { openEditor(null) },
                    onWidgets = { sheet = ScheduleSheet.Widgets },
                    onShare = { shareSchedule(activity) },
                    onExport = { exportSchedule(activity) },
                    onAppearance = { sheet = ScheduleSheet.Appearance },
                )
                if (store.weekOptions().isNotEmpty()) WeekSwitcher(store) { sheet = ScheduleSheet.WeekPicker }
            }
            // The failure state card already carries the message.
            if (store.errorMessage.isNotEmpty() && !(store.result == null && store.status == ScheduleStatus.Failed)) {
                Banner(
                    message = store.errorMessage,
                    action = if (store.authorizationExpired) "去授权" else if (store.result == null) "" else "重试",
                    onAction = {
                        if (store.authorizationExpired) activity.openAcademicAuthorization() else store.load(true)
                    },
                )
                Spacer(Modifier.height(8.dp))
            }
            PullToRefreshBox(
                isRefreshing = store.status == ScheduleStatus.Loading && store.result != null || store.refreshing,
                onRefresh = { store.load(true) },
                modifier = Modifier.weight(1f).fillMaxWidth(),
            ) {
                SchedulePages(
                    store = store,
                    palette = style.palette,
                    translucent = style.background != null,
                    onLogin = { activity.openAcademicAuthorization() },
                    onCourse = ::openCourse,
                    onAddSlot = { day, slot -> if (!store.isGraduate) openEditor(null, day, slot) },
                )
            }
        }
        }
    }

    when (val current = sheet) {
        null -> Unit
        is ScheduleSheet.Detail -> CourseDetailSheet(store, current.block, onDismiss = { sheet = null }) {
            sheet = null
            openEditor(current.block)
        }
        is ScheduleSheet.Overlap -> OverlapSheet(current.blocks, style.palette, onDismiss = { sheet = null }) {
            sheet = ScheduleSheet.Detail(it)
        }
        ScheduleSheet.WeekPicker -> WeekPickerSheet(store, onDismiss = { sheet = null })
        ScheduleSheet.Style -> ScheduleStyleSheet(activity, onDismiss = { sheet = null })
        ScheduleSheet.Widgets -> WidgetSettingsSheet(activity, onDismiss = { sheet = null })
        ScheduleSheet.Editor -> CourseEditorSheet(editor, onDismiss = {
            // The sheet may already be hidden (Back), so it always goes away; a
            // save in flight finishes on its own and reloads the timetable.
            if (!editor.busy) editor.cancel()
            sheet = null
        })
        ScheduleSheet.Appearance -> AppearanceSheet(activity.appearance, onDismiss = { sheet = null })
    }
    if (sheet == ScheduleSheet.Editor && !editor.visible) {
        LaunchedEffect(Unit) { sheet = null }
    }
}

@Composable
private fun ScheduleBackground(style: ScheduleStyleSettings) {
    val colors = LocalScheduleColors.current
    val image = style.background ?: return
    Box(Modifier.fillMaxSize()) {
        Image(
            bitmap = image,
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxSize().let {
                if (style.blur > 0 && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) it.blur(style.blur.dp) else it
            },
        )
        val overlay = 1 - style.visibility
        Box(
            Modifier.fillMaxSize().background(
                (if (colors.dark) Color(0xFF0B1B18) else Color(0xFFF8FBFF))
                    .copy(alpha = if (colors.dark) max(0.22f, overlay * 0.58f) else overlay),
            ),
        )
    }
}

@Composable
private fun ScheduleToolbar(
    store: ScheduleStore,
    onRefresh: () -> Unit,
    onStyle: () -> Unit,
    onTools: () -> Unit,
    onWidgets: () -> Unit,
    onShare: () -> Unit,
    onExport: () -> Unit,
    onAppearance: () -> Unit,
) {
    val colors = LocalScheduleColors.current
    var semesterMenu by remember { mutableStateOf(false) }
    var moreMenu by remember { mutableStateOf(false) }
    val canChooseSemester = store.semesterOptions().size > 1
    Row(Modifier.fillMaxWidth().height(40.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.weight(1f).height(40.dp).clickable(enabled = canChooseSemester) { semesterMenu = true }) {
            Row(
                Modifier.fillMaxWidth().height(32.dp).align(Alignment.Center).clip(RoundedCornerShape(16.dp)).background(colors.surface)
                    .padding(start = 12.dp, end = 6.dp)
                    .semantics { contentDescription = "选择学期，当前 ${semesterLabel(store)}" },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    compactSemesterLabel(store), color = colors.text, fontSize = 12.sp, lineHeight = 16.sp, letterSpacing = 0.sp, fontWeight = FontWeight.SemiBold,
                    maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f),
                )
                if (canChooseSemester) Icon(Icons.Rounded.ArrowDropDown, contentDescription = null, tint = colors.secondary)
            }
            DropdownMenu(expanded = semesterMenu, onDismissRequest = { semesterMenu = false }) {
                store.semesterOptions().forEach { option ->
                    DropdownMenuItem(
                        text = { Text(option.label, fontWeight = if (option.value == store.selectedSemester) FontWeight.Bold else FontWeight.Normal) },
                        onClick = {
                            semesterMenu = false
                            store.selectSemester(option.value)
                        },
                    )
                }
            }
        }
        Spacer(Modifier.width(6.dp))
        Row(
            Modifier.width(76.dp).height(32.dp).clip(RoundedCornerShape(16.dp)).background(colors.softSurface).padding(2.dp),
        ) {
            ModeButton("日", store.viewMode == "day", Modifier.weight(1f)) { store.selectViewMode("day") }
            ModeButton("周", store.viewMode == "week", Modifier.weight(1f)) { store.selectViewMode("week") }
        }
        Spacer(Modifier.width(6.dp))
        Box(
            Modifier.size(32.dp).clip(CircleShape).background(colors.surface).clickable { store.returnToCurrentWeek() }
                .semantics { contentDescription = "回到本周今日" },
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Outlined.NearMe, contentDescription = null, tint = colors.text, modifier = Modifier.size(18.dp))
        }
        Box {
            IconButton(onClick = { moreMenu = true }, modifier = Modifier.size(width = 34.dp, height = 40.dp)) {
                if (store.status == ScheduleStatus.Loading || store.refreshing) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = colors.accent)
                } else {
                    Icon(Icons.Rounded.MoreHoriz, contentDescription = "更多课表操作", tint = colors.text)
                }
            }
            DropdownMenu(expanded = moreMenu, onDismissRequest = { moreMenu = false }) {
                listOf(
                    "刷新课表" to onRefresh,
                    "课表配色与背景" to onStyle,
                    "添加与恢复课程" to onTools,
                    "桌面课表小组件" to onWidgets,
                    "分享所选周课表" to onShare,
                    "导出所选周日历" to onExport,
                    "应用外观" to onAppearance,
                ).forEach { (label, action) ->
                    val enabled = when (label) {
                        "刷新课表" -> store.status != ScheduleStatus.Loading
                        "添加与恢复课程" -> !store.isGraduate
                        else -> true
                    }
                    DropdownMenuItem(text = { Text(label) }, enabled = enabled, onClick = {
                        moreMenu = false
                        action()
                    })
                }
            }
        }
    }
    Spacer(Modifier.height(2.dp))
}

private fun semesterLabel(store: ScheduleStore): String =
    store.semesterOptions().firstOrNull { it.value == store.selectedSemester }?.label ?: store.selectedSemester.ifEmpty { "选择学期" }

private fun compactSemesterLabel(store: ScheduleStore): String {
    val parts = store.selectedSemester.split('-')
    return if (parts.size == 3 && parts[0].length == 4 && parts[1].length == 4) {
        "${parts[0]}–${parts[1].takeLast(2)} · ${when (parts[2]) { "1" -> "秋"; "2" -> "春"; else -> "夏" }}"
    } else semesterLabel(store)
}

@Composable
private fun ModeButton(label: String, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val colors = LocalScheduleColors.current
    Box(
        modifier.fillMaxSize().clip(RoundedCornerShape(19.dp)).background(if (selected) colors.surface else Color.Transparent)
            .clickable(onClick = onClick).semantics {
                contentDescription = "${label}视图"
                this.selected = selected
            },
        contentAlignment = Alignment.Center,
    ) {
        Text(label, fontSize = 12.sp, lineHeight = 16.sp, letterSpacing = 0.sp, fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
            color = if (selected) colors.text else colors.secondary)
    }
}

@Composable
private fun WeekSwitcher(store: ScheduleStore, onPick: () -> Unit) {
    val colors = LocalScheduleColors.current
    val label = store.selectedWeek.takeIf { it.isNotEmpty() }?.let { "第${it}周" } ?: "选择周次"
    val start = store.dayDate(1)
    val end = store.dayDate(7)
    val range = if (start.isNotEmpty() && end.isNotEmpty()) "${start.replace('-', '.')} - ${end.replace('-', '.')}" else "校历暂无日期"
    val current = store.isCurrentWeek()
    val glass = LocalScheduleGlass.current
    Row(
        Modifier.fillMaxWidth().height(42.dp)
            .then(if (glass != null) Modifier.clip(RoundedCornerShape(18.dp)).background(glass) else Modifier),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = { store.moveWeek(-1) }, enabled = store.canMoveWeek(-1)) {
            Icon(Icons.AutoMirrored.Rounded.KeyboardArrowLeft, contentDescription = "上一周", tint = colors.text)
        }
        Column(
            Modifier.weight(1f).clip(RoundedCornerShape(16.dp)).clickable(onClick = onPick).padding(vertical = 2.dp)
                .semantics { contentDescription = "选择周次，$label，$range" },
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(label, fontSize = 14.sp, lineHeight = 18.sp, letterSpacing = 0.sp, fontWeight = FontWeight.SemiBold, color = colors.text)
                if (current) {
                    Spacer(Modifier.width(6.dp))
                    Text("本周", fontSize = 10.sp, color = colors.accent, fontWeight = FontWeight.Bold,
                        modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(colors.accent.copy(alpha = 0.12f))
                            .padding(horizontal = 5.dp, vertical = 1.dp))
                }
            }
            Text(range, fontSize = 10.sp, lineHeight = 14.sp, letterSpacing = 0.sp, color = colors.secondary, maxLines = 1)
        }
        IconButton(onClick = { store.moveWeek(1) }, enabled = store.canMoveWeek(1)) {
            Icon(Icons.AutoMirrored.Rounded.KeyboardArrowRight, contentDescription = "下一周", tint = colors.text)
        }
    }
    Spacer(Modifier.height(2.dp))
}

@Composable
private fun Banner(message: String, action: String, onAction: () -> Unit) {
    val colors = LocalScheduleColors.current
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(colors.surface).padding(horizontal = 11.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Rounded.Info, contentDescription = null, tint = colors.accent, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(8.dp))
        Text(message, fontSize = 12.sp, color = colors.text, maxLines = 3, modifier = Modifier.weight(1f))
        if (action.isNotEmpty()) TextButton(onClick = onAction) { Text(action, fontSize = 12.sp) }
    }
}

@Composable
private fun SchedulePages(
    store: ScheduleStore,
    palette: String,
    translucent: Boolean,
    onLogin: () -> Unit,
    onCourse: (CourseBlock, String) -> Unit,
    onAddSlot: (Int, Int) -> Unit,
) {
    val weeks = store.weekOptions()
    if (weeks.isEmpty()) {
        ScheduleBody(store, store.selectedWeek, store.result, palette, translucent, onLogin, onCourse, onAddSlot)
        return
    }
    // Keep the page model keyed by semester and mode so a new term rebuilds the pager.
    key(store.selectedSemester, store.viewMode, weeks.size) {
        if (store.viewMode == "day") {
            val pager = rememberPagerState(initialPage = store.selectedDay - 1) { 7 }
            LaunchedEffect(store.selectedDay) {
                if (pager.currentPage != store.selectedDay - 1) pager.animateScrollToPage(store.selectedDay - 1)
            }
            LaunchedEffect(pager) {
                snapshotFlow { pager.settledPage }.collect { store.selectDay(it + 1) }
            }
            Column(Modifier.fillMaxSize()) {
                DayStrip(store, store.selectedWeek) { store.selectDay(it) }
                HorizontalPager(state = pager, modifier = Modifier.weight(1f).fillMaxWidth(), beyondViewportPageCount = 1) { page ->
                    val data = store.resultFor(store.selectedWeek)
                    ScheduleBody(store, store.selectedWeek, data, palette, translucent, onLogin, onCourse, onAddSlot, day = page + 1)
                }
            }
        } else {
            val index = store.selectedWeekIndex()
            val pager = rememberPagerState(initialPage = index) { weeks.size }
            LaunchedEffect(index) {
                if (pager.currentPage != index) pager.animateScrollToPage(index)
            }
            LaunchedEffect(pager) {
                // The first emission is the initial page; when the selected week is
                // not in the list (a vacation week) it would wrongly select week 1.
                snapshotFlow { pager.settledPage }.drop(1).collect { page -> weeks.getOrNull(page)?.let { store.selectWeek(it.value) } }
            }
            HorizontalPager(state = pager, modifier = Modifier.fillMaxSize(), beyondViewportPageCount = 1) { page ->
                val week = weeks[page].value
                // Reading the revision lets an adjacent page pick up a prefetched week.
                val revision = store.dataRevision
                val data = remember(week, revision, store.result) { store.resultFor(week) }
                ScheduleBody(store, week, data, palette, translucent, onLogin, onCourse, onAddSlot)
            }
        }
    }
}

@Composable
private fun ScheduleBody(
    store: ScheduleStore,
    week: String,
    data: ScheduleResult?,
    palette: String,
    translucent: Boolean,
    onLogin: () -> Unit,
    onCourse: (CourseBlock, String) -> Unit,
    onAddSlot: (Int, Int) -> Unit,
    day: Int? = null,
) {
    val selected = week == store.selectedWeek
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val height = maxHeight
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 6.dp)) {
            when {
                data == null && selected && store.status == ScheduleStatus.Unauthorized -> StateCard(
                    "教务授权已失效", "请重新登录并完成教务授权后读取课表", "去授权", onLogin,
                )
                data == null && selected && store.status == ScheduleStatus.Failed -> StateCard(
                    "课表暂时无法加载", store.errorMessage.ifEmpty { "请检查网络连接后重试" }, "重新加载",
                ) { store.load(true) }
                data == null -> LoadingCard(store.bridgeReady)
                day != null -> {
                    val blocks = store.blocksForDay(day, week, data)
                    val adjustment = store.adjustment(day, week)
                    if (adjustment != null && blocks.isNotEmpty()) AdjustmentNotice(store, adjustment, day, week)
                    if (blocks.isEmpty() && adjustment?.kind == "off") StateCard(
                        "这一天放假，不上课", store.adjustmentDetail(adjustment), if (store.isGraduate) "" else "添加课程",
                    ) { onAddSlot(day, 1) }
                    else if (blocks.isEmpty()) StateCard(
                        "这一天没有课程",
                        adjustment?.let { store.adjustmentDetail(it) } ?: "可以切换日期，或添加个人课程",
                        if (store.isGraduate) "" else "添加课程",
                    ) { onAddSlot(day, 1) }
                    else DayTimeline(store, day, week, blocks, palette, translucent, height, onCourse, onAddSlot)
                }
                else -> WeekGrid(store, week, data, palette, translucent, height, onCourse, onAddSlot)
            }
        }
    }
}

/** The day view's note for a holiday or make-up day that still has classes. */
@Composable
private fun AdjustmentNotice(store: ScheduleStore, adjustment: ScheduleAdjustment, day: Int, week: String) {
    val colors = LocalScheduleColors.current
    Text(
        "${store.dayDate(day, week).replace('-', '.')} ${WEEKDAY_LABELS[day - 1]} · ${store.adjustmentDetail(adjustment)}",
        fontSize = 12.sp, color = colors.accent, fontWeight = FontWeight.Bold,
        modifier = Modifier.fillMaxWidth().padding(start = 4.dp, bottom = 8.dp),
    )
}

@Composable
private fun DayHeaderCell(store: ScheduleStore, day: Int, week: String, highlighted: Boolean, modifier: Modifier) {
    val colors = LocalScheduleColors.current
    val date = store.dayDate(day, week)
    val adjustment = store.adjustment(day, week)
    val glass = LocalScheduleGlass.current
    Column(
        modifier.height(36.dp).clip(RoundedCornerShape(10.dp))
            .background(if (highlighted) colors.accent.copy(alpha = 0.10f) else glass ?: Color.Transparent)
            .border(if (highlighted) 0.8.dp else 0.dp, if (highlighted) colors.accent.copy(alpha = 0.28f) else Color.Transparent, RoundedCornerShape(12.dp)),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(WEEKDAY_LABELS[day - 1], fontSize = 11.sp, lineHeight = 14.sp, letterSpacing = 0.sp, fontWeight = FontWeight.SemiBold, color = if (highlighted) colors.accent else colors.text)
            if (adjustment != null) {
                // 休 = day off, 班 = make-up day, like the iOS day badges.
                Text(
                    if (adjustment.kind == "off") "休" else "班", fontSize = 9.sp, lineHeight = 10.sp, fontWeight = FontWeight.Bold,
                    color = if (adjustment.kind == "off") colors.secondary else colors.accent,
                    modifier = Modifier.padding(start = 1.dp),
                )
            }
        }
        Text(if (date.isEmpty()) "—" else date.replace('-', '.'), fontSize = 9.sp, lineHeight = 12.sp, letterSpacing = 0.sp, color = colors.secondary)
    }
}

@Composable
private fun DayStrip(store: ScheduleStore, week: String, onSelect: (Int) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        (1..7).forEach { day ->
            DayHeaderCell(
                store, day, week, highlighted = day == store.selectedDay,
                modifier = Modifier.weight(1f).clip(RoundedCornerShape(12.dp)).clickable { onSelect(day) }
                    .semantics {
                        contentDescription = WEEKDAY_LABELS[day - 1] + " " + store.dayDate(day, week) +
                            store.adjustment(day, week)?.let { if (it.kind == "off") "，休息" else "，补班" }.orEmpty()
                        selected = day == store.selectedDay
                    },
            )
        }
    }
}

@Composable
private fun WeekGrid(
    store: ScheduleStore,
    week: String,
    data: ScheduleResult,
    palette: String,
    translucent: Boolean,
    height: Dp,
    onCourse: (CourseBlock, String) -> Unit,
    onAddSlot: (Int, Int) -> Unit,
) {
    val colors = LocalScheduleColors.current
    val stride = compactWeekRowHeight(height.value).dp
    val cellColor = if (translucent) colors.cell.copy(alpha = if (colors.dark) 0.52f else 0.36f) else colors.cell
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            val glass = LocalScheduleGlass.current
            Text("节次", fontSize = 10.sp, lineHeight = 14.sp, letterSpacing = 0.sp, color = colors.secondary, textAlign = TextAlign.Center,
                modifier = Modifier.width(38.dp).height(36.dp)
                    .then(if (glass != null) Modifier.clip(RoundedCornerShape(12.dp)).background(glass) else Modifier)
                    .padding(top = 10.dp))
            (1..7).forEach { day ->
                DayHeaderCell(
                    store, day, week, highlighted = store.isToday(day, week),
                    modifier = Modifier.weight(1f).clip(RoundedCornerShape(12.dp)).clickable {
                        store.selectDay(day)
                        store.selectViewMode("day")
                    }.semantics {
                        val note = store.adjustment(day, week)?.let { if (it.kind == "off") "，休息" else "，补班" }.orEmpty()
                        contentDescription = WEEKDAY_LABELS[day - 1] + note + "，查看当天课程"
                    },
                )
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Column(Modifier.width(38.dp)) { (1..SLOT_COUNT).forEach { SlotAxis(store, it, stride) } }
            (1..7).forEach { day ->
                val blocks = store.blocksForDay(day, week, data)
                // Days off are drawn faded so the holiday reads at a glance.
                val dayCell = if (store.adjustment(day, week)?.kind == "off") cellColor.copy(alpha = cellColor.alpha * 0.45f) else cellColor
                Box(Modifier.weight(1f).height(stride * SLOT_COUNT)) {
                    Column {
                        (1..SLOT_COUNT).forEach { slot ->
                            Box(
                                Modifier.fillMaxWidth().height(stride - 4.dp).clip(RoundedCornerShape(8.dp)).background(dayCell)
                                    .border(0.5.dp, colors.divider.copy(alpha = if (colors.dark) 0.65f else 0.6f), RoundedCornerShape(8.dp))
                                    .clickable { onAddSlot(day, slot) }
                                    .semantics { contentDescription = WEEKDAY_LABELS[day - 1] + "第${slot}节，添加课程" },
                            )
                            Spacer(Modifier.height(4.dp))
                        }
                    }
                    blocks.forEach { block ->
                        val tone = scheduleCardTone(block.course.name, palette, colors.dark)
                        val span = block.endSlot - block.startSlot + 1
                        val overlaps = blocks.count { it.startSlot <= block.endSlot && it.endSlot >= block.startSlot }
                        Column(
                            Modifier.offset(y = stride * (block.startSlot - 1)).fillMaxWidth().height(stride * span - 4.dp)
                                .clip(RoundedCornerShape(9.dp)).background(colors.surface)
                                .background(androidx.compose.ui.graphics.Brush.verticalGradient(listOf(Color(tone.highlight), Color(tone.fill))))
                                .border(1.dp, Color(tone.border), RoundedCornerShape(9.dp))
                                .clickable { onCourse(block, week) }
                                .semantics { contentDescription = courseAccessibility(block) }
                                .padding(horizontal = 2.dp, vertical = 3.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.Center,
                        ) {
                            Text(
                                block.course.name, fontSize = 10.sp, lineHeight = 12.sp, letterSpacing = 0.sp, fontWeight = FontWeight.Medium,
                                color = Color(tone.text), textAlign = TextAlign.Center,
                                maxLines = if (span == 1) 2 else 6, overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.weight(1f, fill = false),
                            )
                            if (!block.course.location.isNullOrEmpty() && span > 1) {
                                Spacer(Modifier.height(3.dp))
                                Text(block.course.location, fontSize = 9.sp, lineHeight = 11.sp, letterSpacing = 0.sp, fontWeight = FontWeight.Normal,
                                    color = Color(tone.text).copy(alpha = 0.86f), textAlign = TextAlign.Center,
                                    maxLines = 2, overflow = TextOverflow.Ellipsis)
                            }
                            if (overlaps > 1 && span > 1) {
                                Text("+${overlaps - 1} 门", fontSize = 8.sp, lineHeight = 10.sp, color = Color(tone.text), maxLines = 1)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SlotAxis(store: ScheduleStore, slot: Int, stride: Dp) {
    val colors = LocalScheduleColors.current
    val period = store.periodTime(slot)
    val glass = LocalScheduleGlass.current
    // With a photo behind, each label gets a plate shaped like the grid cells beside it.
    val plate = if (glass != null) Modifier.padding(bottom = 5.dp).clip(RoundedCornerShape(9.dp)).background(glass) else Modifier
    Column(
        Modifier.fillMaxWidth().height(stride).then(plate),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(slot.toString(), fontSize = 11.sp, lineHeight = 14.sp, letterSpacing = 0.sp, fontWeight = FontWeight.SemiBold, color = colors.text)
        Text(period.startTime, fontSize = 8.sp, lineHeight = 10.sp, letterSpacing = 0.sp, color = colors.secondary)
        Text(period.endTime, fontSize = 8.sp, lineHeight = 10.sp, letterSpacing = 0.sp, color = colors.secondary)
    }
}

@Composable
private fun DayTimeline(
    store: ScheduleStore,
    day: Int,
    week: String,
    blocks: List<CourseBlock>,
    palette: String,
    translucent: Boolean,
    height: Dp,
    onCourse: (CourseBlock, String) -> Unit,
    onAddSlot: (Int, Int) -> Unit,
) {
    val colors = LocalScheduleColors.current
    val stride = max(52f, (height.value - 12f) / SLOT_COUNT).dp
    val cellColor = if (translucent) colors.cell.copy(alpha = if (colors.dark) 0.52f else 0.36f) else colors.cell
    Row(Modifier.fillMaxWidth()) {
        Column(Modifier.width(38.dp)) { (1..SLOT_COUNT).forEach { SlotAxis(store, it, stride) } }
        Spacer(Modifier.width(10.dp))
        Box(Modifier.weight(1f).height(stride * SLOT_COUNT)) {
            Column {
                (1..SLOT_COUNT).forEach { slot ->
                    Box(
                        Modifier.fillMaxWidth().height(stride - 4.dp).clip(RoundedCornerShape(10.dp)).background(cellColor)
                            .border(0.5.dp, colors.divider, RoundedCornerShape(10.dp))
                            .clickable { onAddSlot(day, slot) }
                            .semantics { contentDescription = "第${slot}节，添加课程" },
                    )
                    Spacer(Modifier.height(4.dp))
                }
            }
            blocks.forEach { block ->
                val tone = scheduleCardTone(block.course.name, palette, colors.dark)
                val span = block.endSlot - block.startSlot + 1
                val overlaps = blocks.count { it.startSlot <= block.endSlot && it.endSlot >= block.startSlot }
                val meta = listOfNotNull(block.course.location?.let { "@$it" }, block.course.teacher).joinToString(" · ")
                Column(
                    Modifier.offset(y = stride * (block.startSlot - 1)).fillMaxWidth().height(stride * span - 4.dp)
                        .clip(RoundedCornerShape(12.dp)).background(colors.surface)
                        .background(androidx.compose.ui.graphics.Brush.verticalGradient(listOf(Color(tone.highlight), Color(tone.fill))))
                        .border(1.dp, Color(tone.border), RoundedCornerShape(12.dp))
                        .clickable { onCourse(block, week) }
                        .semantics { contentDescription = courseAccessibility(block) }
                        .padding(horizontal = 16.dp, vertical = 6.dp),
                    verticalArrangement = Arrangement.Center,
                ) {
                    Text(block.course.name, fontSize = if (span == 1) 13.sp else 16.sp, fontWeight = FontWeight.Medium,
                        color = Color(tone.text), maxLines = if (span == 1) 1 else 3, overflow = TextOverflow.Ellipsis)
                    Spacer(Modifier.height(4.dp))
                    Text(meta.ifEmpty { "地点待确认" }, fontSize = 11.sp, color = Color(tone.text).copy(alpha = 0.82f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (span > 1) {
                        Text("${block.course.slotNote ?: "第 ${block.startSlot}–${block.endSlot} 节"} · ${store.timeRange(block.startSlot, block.endSlot)}",
                            fontSize = 11.sp, color = Color(tone.text), maxLines = 1)
                    }
                    if (overlaps > 1 && span > 1) {
                        Text("$overlaps 门课程重叠，点击查看", fontSize = 10.sp, color = colors.secondary)
                    }
                }
            }
        }
    }
}

@Composable
private fun LoadingCard(bridgeReady: Boolean) {
    val colors = LocalScheduleColors.current
    Column(
        Modifier.fillMaxWidth().heightIn(min = 260.dp).clip(RoundedCornerShape(16.dp)).background(colors.surface).padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        CircularProgressIndicator(Modifier.size(30.dp), strokeWidth = 3.dp)
        Spacer(Modifier.height(14.dp))
        Text("正在加载课表", fontSize = 17.sp, fontWeight = FontWeight.Medium, color = colors.text)
        Spacer(Modifier.height(6.dp))
        Text(if (bridgeReady) "正在从教务服务读取最新安排" else "正在恢复登录状态与课表服务",
            fontSize = 13.sp, color = colors.secondary, textAlign = TextAlign.Center)
    }
}

@Composable
private fun StateCard(title: String, message: String, action: String, onAction: () -> Unit) {
    val colors = LocalScheduleColors.current
    Column(
        Modifier.fillMaxWidth().heightIn(min = 220.dp).clip(RoundedCornerShape(16.dp)).background(colors.surface).padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(title, fontSize = 17.sp, fontWeight = FontWeight.Medium, color = colors.text)
        Spacer(Modifier.height(8.dp))
        Text(message, fontSize = 13.sp, color = colors.secondary, textAlign = TextAlign.Center)
        if (action.isNotEmpty()) {
            Spacer(Modifier.height(14.dp))
            Button(onClick = onAction) { Text(action) }
        }
    }
}

internal fun courseAccessibility(block: CourseBlock): String =
    WEEKDAY_LABELS[block.day - 1] + "，" + block.course.name + "，第" + block.startSlot + "至" + block.endSlot + "节，" +
        block.course.location.orEmpty()

/** A frosted plate colour while a background photo is shown, else null (see [NativeScheduleScreen]). */
internal val LocalScheduleGlass = staticCompositionLocalOf<Color?> { null }
