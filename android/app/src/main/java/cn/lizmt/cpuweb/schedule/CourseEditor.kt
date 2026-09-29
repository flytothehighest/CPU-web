package cn.lizmt.cpuweb.schedule

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

/**
 * Personal course edits. The Web bundle owns the rule engine and the edit
 * endpoints (including CSRF and the concurrent-edit baseline); this model only
 * collects the form and mirrors the replies, exactly like the Web editor.
 */
class CourseEditorModel(
    private val web: WebSession,
    private val scope: CoroutineScope,
    private val onSaved: () -> Unit,
) {
    var visible by mutableStateOf(false)
        private set
    var busy by mutableStateOf(false)
        private set
    var error by mutableStateOf("")
        private set
    var name by mutableStateOf("")
    var day by mutableIntStateOf(1)
    var startSlot by mutableIntStateOf(1)
    var endSlot by mutableIntStateOf(2)
    var location by mutableStateOf("")
    var teacher by mutableStateOf("")
    var note by mutableStateOf("")
    var weeks by mutableStateOf(listOf<Int>())
    var options by mutableStateOf(listOf<Int>())
    var hidden by mutableStateOf(listOf<HiddenCourse>())
        private set

    /** The edit session issued by the Web editor; saving is only possible once it exists. */
    var session by mutableStateOf("")
        private set
    var original by mutableStateOf<CourseBlock?>(null)
        private set
    private var semester = ""
    private var cells = "[]"

    data class HiddenCourse(val key: String, val label: String)

    fun open(store: ScheduleStore, block: CourseBlock?) {
        val current = store.result ?: return
        reset()
        original = block
        semester = store.selectedSemester
        cells = JSONArray().apply { current.cells.forEach { put(it.toJson()) } }.toString()
        name = block?.course?.name.orEmpty()
        day = block?.day ?: store.selectedDay
        startSlot = block?.startSlot ?: 1
        endSlot = block?.endSlot ?: 2
        location = block?.course?.location.orEmpty()
        teacher = block?.course?.teacher.orEmpty()
        note = block?.course?.editableNote.orEmpty()
        options = store.weekOptions().mapNotNull { it.value.toIntOrNull() }.filter { it in 1..64 }
        weeks = when {
            block == null -> listOfNotNull(store.selectedWeek.toIntOrNull())
            block.course.weekList.isNotEmpty() -> block.course.weekList
            else -> options
        }
        visible = true
        submit("open")
    }

    fun prefill(selectedDay: Int, slot: Int) {
        day = selectedDay
        startSlot = slot
        endSlot = (slot + 1).coerceAtMost(SLOT_COUNT)
    }

    fun cancel() {
        reset()
    }

    private fun reset() {
        visible = false
        busy = false
        error = ""
        session = ""
        original = null
        cells = "[]"
        hidden = emptyList()
    }

    fun toggleWeek(week: Int) {
        weeks = if (weeks.contains(week)) weeks - week else (weeks + week).sorted()
    }

    fun submit(action: String, key: String = "") {
        if (busy) return
        if (action == "save" && (name.isBlank() || weeks.isEmpty() || endSlot < startSlot)) {
            error = "请填写课程名称，选择周次并检查节次范围"
            return
        }
        busy = true
        error = ""
        val payload = JSONObject().apply {
            put("action", action)
            put("semester", semester)
            put("session", session)
            put("key", key)
            original?.let { put("original", it.toJson()) }
            put("cells", JSONArray(cells))
            put("form", JSONObject().apply {
                put("name", name)
                put("day", day)
                put("startSlot", startSlot)
                put("endSlot", endSlot)
                put("teacher", teacher)
                put("location", location)
                put("note", note)
                put("weekList", JSONArray(weeks))
            })
        }
        scope.launch {
            val raw = web.editCourse(payload)
            busy = false
            val reply = raw?.let { runCatching { JSONObject(it) }.getOrNull() }
            if (reply == null) {
                error = "课程操作失败，请重试"
                return@launch
            }
            val replyError = reply.optString("error")
            if (replyError.isNotEmpty()) {
                error = replyError
                return@launch
            }
            if (reply.optBoolean("saved", false)) {
                reset()
                onSaved()
                return@launch
            }
            session = reply.optString("session")
            hidden = runCatching {
                val array = reply.optJSONArray("hidden") ?: JSONArray()
                (0 until array.length()).mapNotNull { index ->
                    array.optJSONObject(index)?.let { HiddenCourse(it.optString("key"), it.optString("label")) }
                }
            }.getOrDefault(emptyList())
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun CourseEditorSheet(model: CourseEditorModel, onDismiss: () -> Unit) {
    var dayMenu by remember { mutableStateOf(false) }
    var startMenu by remember { mutableStateOf(false) }
    var endMenu by remember { mutableStateOf(false) }
    var confirmingDelete by remember { mutableStateOf(false) }
    if (confirmingDelete) {
        AlertDialog(
            onDismissRequest = { confirmingDelete = false },
            title = { Text(if (model.original?.course?.customId != null) "删除个人课程" else "隐藏课程") },
            text = {
                Text(
                    if (model.original?.course?.customId != null) "这门个人添加的课程会从课表中删除。"
                    else "这只修改你的个人课表，不会改变学校教务记录。",
                )
            },
            confirmButton = {
                TextButton(onClick = { confirmingDelete = false; model.submit("delete") }) { Text("确认") }
            },
            dismissButton = { TextButton(onClick = { confirmingDelete = false }) { Text("取消") } },
        )
    }
    androidx.compose.material3.ModalBottomSheet(
        onDismissRequest = onDismiss,
        // A drag or scrim tap cannot close the sheet mid-save; Back still can.
        sheetState = rememberModalBottomSheetState(
            skipPartiallyExpanded = true,
            confirmValueChange = { it != androidx.compose.material3.SheetValue.Hidden || !model.busy },
        ),
    ) {
        Column(Modifier.fillMaxWidth().imePadding().padding(start = 16.dp, end = 16.dp, bottom = 12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                Text(if (model.original != null) "编辑课程" else "添加课程",
                    style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                if (model.busy) CircularProgressIndicator(Modifier.width(20.dp).height(20.dp), strokeWidth = 2.dp)
            }
            if (model.error.isNotEmpty()) {
                Spacer(Modifier.height(10.dp))
                Text(model.error, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
            }
            if (model.busy && model.session.isEmpty()) {
                Spacer(Modifier.height(12.dp))
                Text("正在读取个人课程修改", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Spacer(Modifier.height(12.dp))
            // Only the form scrolls; the save action keeps its own space even
            // with many teaching weeks, larger text or an open keyboard.
            Column(
                modifier = Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedTextField(
                    value = model.name, onValueChange = { model.name = it },
                    label = { Text("课程名称（必填）") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                    enabled = !model.busy, modifier = Modifier.fillMaxWidth(),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    SelectField(
                        label = "星期", value = WEEKDAY_LABELS[model.day - 1], expanded = dayMenu,
                        options = WEEKDAY_LABELS, onExpanded = { dayMenu = it },
                        onSelect = { model.day = it + 1 }, modifier = Modifier.weight(1.2f), enabled = !model.busy,
                    )
                    SelectField(
                        label = "开始", value = "第${model.startSlot}节", expanded = startMenu,
                        options = (1..SLOT_COUNT).map { "第${it}节" }, onExpanded = { startMenu = it },
                        onSelect = { model.startSlot = it + 1 }, modifier = Modifier.weight(1f), enabled = !model.busy,
                    )
                    SelectField(
                        label = "结束", value = "第${model.endSlot}节", expanded = endMenu,
                        options = (1..SLOT_COUNT).map { "第${it}节" }, onExpanded = { endMenu = it },
                        onSelect = { model.endSlot = it + 1 }, modifier = Modifier.weight(1f), enabled = !model.busy,
                    )
                }
                OutlinedTextField(value = model.location, onValueChange = { model.location = it },
                    label = { Text("上课地点") }, singleLine = true, enabled = !model.busy, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(value = model.teacher, onValueChange = { model.teacher = it },
                    label = { Text("授课教师") }, singleLine = true, enabled = !model.busy, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(value = model.note, onValueChange = { model.note = it },
                    label = { Text("备注（选填）") }, singleLine = true, enabled = !model.busy, modifier = Modifier.fillMaxWidth())
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("教学周", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                    Text("已选 ${model.weeks.size} 周", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton(onClick = { model.weeks = model.options }, enabled = !model.busy) { Text("全部") }
                    TextButton(onClick = { model.weeks = model.options.filter { it % 2 == 1 } }, enabled = !model.busy) { Text("单周") }
                    TextButton(onClick = { model.weeks = model.options.filter { it % 2 == 0 } }, enabled = !model.busy) { Text("双周") }
                }
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                    maxItemsInEachRow = 6,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    model.options.forEach { week ->
                        val selected = model.weeks.contains(week)
                        Box(
                            Modifier.weight(1f).heightIn(min = 42.dp).clip(RoundedCornerShape(10.dp))
                                .background(if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceContainerHigh)
                                .clickable(enabled = !model.busy) { model.toggleWeek(week) }
                                .semantics { contentDescription = "第${week}周"; this.selected = selected },
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                week.toString(),
                                color = if (selected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
                                fontSize = 13.sp,
                            )
                        }
                    }
                }
                if (model.original != null) {
                    Button(
                        onClick = { confirmingDelete = true },
                        enabled = !model.busy,
                        colors = androidx.compose.material3.ButtonDefaults.buttonColors(
                            containerColor = MaterialTheme.colorScheme.errorContainer,
                            contentColor = MaterialTheme.colorScheme.onErrorContainer,
                        ),
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text(if (model.original?.course?.customId != null) "删除个人课程" else "隐藏这门课程") }
                    if (!model.original?.course?.sourceKey.isNullOrEmpty()) {
                        TextButton(onClick = { model.submit("restore") }, enabled = !model.busy) { Text("恢复教务原始安排") }
                    }
                } else if (model.hidden.isNotEmpty()) {
                    Text("已隐藏课程", style = MaterialTheme.typography.titleSmall)
                    model.hidden.forEach { item ->
                        TextButton(onClick = { model.submit("restoreHidden", item.key) }, enabled = !model.busy) {
                            Text("恢复 · ${item.label}")
                        }
                    }
                }
            }
            Spacer(Modifier.height(14.dp))
            Button(
                onClick = { model.submit("save") },
                enabled = !model.busy && model.session.isNotEmpty(),
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
            ) { Text(if (model.busy) "处理中" else "保存课程") }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SelectField(
    label: String,
    value: String,
    expanded: Boolean,
    options: List<String>,
    onExpanded: (Boolean) -> Unit,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    Box(modifier) {
        Column(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp))
                .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(8.dp))
                .clickable(enabled = enabled) { onExpanded(true) }.padding(horizontal = 10.dp, vertical = 8.dp)
                .semantics { contentDescription = label },
        ) {
            Text(label, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(value, fontSize = 14.sp, maxLines = 1)
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { onExpanded(false) }) {
            options.forEachIndexed { index, option ->
                DropdownMenuItem(text = { Text(option) }, onClick = {
                    onExpanded(false)
                    onSelect(index)
                })
            }
        }
    }
}
