<template>
  <main class="couple-page">
    <header class="couple-head">
      <div>
        <p class="eyebrow">情侣课表</p>
        <h1>{{ status?.status === "active" ? "我们的课表" : "和 TA 一起看课表" }}</h1>
      </div>
      <el-button @click="$router.push('/schedule')">我的课表</el-button>
    </header>

    <div v-if="loading" class="couple-body"><el-skeleton :rows="8" animated /></div>
    <el-alert v-else-if="loadError" class="couple-body" type="error" :closable="false" :title="loadError">
      <el-button size="small" @click="refreshAll">重试</el-button>
    </el-alert>

    <!-- 未绑定 / 等待对方接受 -->
    <section v-else-if="status && status.status !== 'active'" class="couple-body bind-layout">
      <article class="panel bind-intro">
        <div class="intro-hearts" aria-hidden="true">
          <span class="dot me" /><HeartIcon class="intro-heart" /><span class="dot ta" />
        </div>
        <h2>绑定后，你们可以</h2>
        <ul>
          <li>在同一张周课表里看到两个人的课</li>
          <li>一眼找到两个人都没课的时间</li>
          <li>随时看到 TA 此刻在上什么课、几点下课</li>
          <li>记录在一起的天数</li>
        </ul>
        <p class="muted">双方各自打开一次“我的课表”后会自动同步当前学期课表（含你手动修改的课程）。任何一方都可以随时解除绑定，解除后双方的课表快照会立即删除。</p>
      </article>

      <article class="panel">
        <h2>邀请 TA</h2>
        <template v-if="status.status === 'pending' && status.invite.code && !status.invite.expired">
          <p class="muted">把邀请码发给 TA，TA 在这个页面输入即可绑定。邀请码 {{ inviteExpiresText }} 失效。</p>
          <div class="invite-code" aria-label="我的邀请码">{{ status.invite.code }}</div>
          <div class="row-actions">
            <el-button type="primary" @click="copyInvite">复制邀请</el-button>
            <el-button :loading="busy === 'invite'" @click="createInvite">换一个</el-button>
            <el-button text type="danger" :loading="busy === 'cancel'" @click="cancelInvite">取消邀请</el-button>
          </div>
          <p class="waiting"><span class="pulse" />等待 TA 接受…</p>
        </template>
        <template v-else>
          <p class="muted">生成一个 24 小时内有效的邀请码。</p>
          <p v-if="status.status === 'pending'" class="muted">上一个邀请码已过期。</p>
          <el-button type="primary" :loading="busy === 'invite'" @click="createInvite">生成邀请码</el-button>
        </template>
      </article>

      <article class="panel">
        <h2>输入 TA 的邀请码</h2>
        <p class="muted">如果 TA 已经生成了邀请码，在这里输入。</p>
        <form class="accept-form" @submit.prevent="acceptInvite">
          <el-input
            v-model="acceptCode"
            maxlength="8"
            placeholder="6 位邀请码"
            autocomplete="off"
            aria-label="TA 的邀请码"
            class="code-input"
          />
          <el-button type="primary" native-type="submit" :loading="busy === 'accept'" :disabled="!acceptCode.trim()">绑定</el-button>
        </form>
      </article>
    </section>

    <!-- 已绑定 -->
    <section v-else-if="status?.status === 'active'" class="couple-body">
      <article class="panel hero">
        <div class="hero-person">
          <UserAvatar :size="56" :src="status.me.avatar" :name="status.me.nickname" :seed="status.me.id" />
          <strong>{{ status.me.nickname }}</strong>
          <span class="tag me">我</span>
        </div>
        <div class="hero-center">
          <HeartIcon class="hero-heart" />
          <template v-if="togetherDays">
            <p class="together">在一起第 <b>{{ togetherDays }}</b> 天</p>
            <p v-if="upcomingAnniversary" class="muted small">
              {{ upcomingAnniversary.daysLeft === 0 ? `今天是 ${upcomingAnniversary.years} 周年纪念日` : `距离 ${upcomingAnniversary.years} 周年还有 ${upcomingAnniversary.daysLeft} 天` }}
            </p>
          </template>
          <el-button v-else text type="primary" size="small" @click="anniversaryEditing = true">设置纪念日</el-button>
        </div>
        <div class="hero-person">
          <UserAvatar :size="56" :src="status.partner.avatar" :name="status.partner.nickname" :seed="status.partner.id" />
          <strong>{{ status.partner.nickname }}</strong>
          <span class="tag ta">TA</span>
        </div>
      </article>

      <div class="now-grid">
        <article v-for="card in nowCards" :key="card.key" class="panel now-card" :class="card.key">
          <header>
            <span class="tag" :class="card.key">{{ card.key === "me" ? "我" : "TA" }}</span>
            <span class="muted small">此刻</span>
          </header>
          <strong>{{ card.title }}</strong>
          <p v-if="card.detail" class="muted">{{ card.detail }}</p>
          <p v-if="card.synced" class="muted small">课表同步于 {{ card.synced }}</p>
        </article>
      </div>

      <el-alert v-if="!schedules?.me" type="info" :closable="false" show-icon class="notice">
        <template #title>你的课表还没有同步。打开一次<router-link to="/schedule">我的课表</router-link>，加载完成后会自动同步给 TA。</template>
      </el-alert>
      <el-alert v-if="!schedules?.partner" type="info" :closable="false" show-icon class="notice" title="TA 还没有同步课表，提醒 TA 打开一次“我的课表”就好。" />
      <el-alert
        v-if="schedules?.me && schedules?.partner && schedules.me.semester !== schedules.partner.semester"
        type="warning" :closable="false" show-icon class="notice"
        :title="`你们同步的学期不同（${schedules.me.semester} / ${schedules.partner.semester}），不在对方学期内的日期不会计算共同空闲。`"
      />

      <article v-if="baseCalendar" class="panel sheet">
        <div class="sheet-toolbar">
          <div class="week-nav">
            <button type="button" class="nav-btn" :disabled="!prevWeek" aria-label="上一周" @click="week = prevWeek">‹</button>
            <el-select v-model="week" size="small" aria-label="选择周次" class="week-select">
              <el-option v-for="item in weekOptions" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
            <button type="button" class="nav-btn" :disabled="!nextWeek" aria-label="下一周" @click="week = nextWeek">›</button>
            <span class="week-range">{{ weekRangeText }}</span>
          </div>
          <div class="legend">
            <span><i class="swatch me" />我</span>
            <span><i class="swatch ta" />TA</span>
            <span><i class="swatch free" />都有空</span>
          </div>
        </div>

        <div class="grid-scroll">
          <div class="couple-grid" :style="gridStyle">
            <div class="grid-head corner" style="grid-column: 1; grid-row: 1">节次</div>
            <div
              v-for="(date, index) in weekDates"
              :key="`head-${date}`"
              class="grid-head"
              :class="{ today: date === today }"
              :style="{ gridColumn: `${index * 2 + 2} / span 2`, gridRow: 1 }"
            >
              <b>{{ dayNames[index] }}</b><small>{{ date.slice(5) }}</small>
            </div>
            <template v-for="(period, row) in periods" :key="`p-${period.no}`">
              <div class="slot-axis" :style="{ gridColumn: 1, gridRow: row + 2 }">
                <b>{{ period.no }}</b><small>{{ period.start }}</small>
              </div>
              <div
                v-for="(date, index) in weekDates"
                :key="`c-${period.no}-${date}`"
                class="grid-cell"
                :class="{ today: date === today }"
                :style="{ gridColumn: `${index * 2 + 2} / span 2`, gridRow: row + 2 }"
              />
            </template>
            <div
              v-for="range in weekFreeRanges"
              :key="`free-${range.day}-${range.startSlot}`"
              class="free-block"
              :style="rangeStyle(range.day, range.startSlot, range.endSlot, 'both')"
              :title="`${dayNames[range.day - 1]} ${range.start}-${range.end} 都有空`"
            />
            <button
              v-for="item in weekBlocks"
              :key="item.key"
              type="button"
              class="course-block"
              :class="[item.owner, { selected: selectedKey === item.key }]"
              :style="rangeStyle(item.block.day, item.block.startSlot, item.block.endSlot, item.owner)"
              :title="blockTitle(item)"
              @click="selectedKey = selectedKey === item.key ? '' : item.key"
            >
              <strong>{{ item.block.course.name }}</strong>
              <span v-if="item.block.course.location">{{ item.block.course.location }}</span>
            </button>
          </div>
        </div>

        <div v-if="selectedItem" class="course-detail">
          <span class="tag" :class="selectedItem.owner">{{ selectedItem.owner === "me" ? "我" : "TA" }}</span>
          <div>
            <strong>{{ selectedItem.block.course.name }}</strong>
            <p class="muted">{{ blockTitle(selectedItem) }}</p>
          </div>
        </div>

        <section class="free-list">
          <h3>本周共同空闲</h3>
          <p v-if="!freeByDay.length" class="muted">需要双方都同步课表后才能计算。</p>
          <ul v-else>
            <li v-for="item in freeByDay" :key="item.date" :class="{ today: item.date === today }">
              <span class="free-day">{{ dayNames[item.day - 1] }} <small>{{ item.date.slice(5) }}</small></span>
              <span v-if="item.allDay" class="chip">全天都有空</span>
              <span v-else-if="!item.ranges.length" class="muted small">没有共同空闲</span>
              <span v-for="range in item.ranges" v-else :key="range.startSlot" class="chip">
                {{ range.start }}–{{ range.end }}<small>{{ range.startSlot === range.endSlot ? `第 ${range.startSlot} 节` : `${range.startSlot}-${range.endSlot} 节` }}</small>
              </span>
            </li>
          </ul>
        </section>
      </article>

      <article class="panel settings">
        <h2>设置</h2>
        <div class="setting-row">
          <div>
            <strong>纪念日</strong>
            <p class="muted small">{{ status.anniversary || "未设置" }}，双方都可以修改。</p>
          </div>
          <div v-if="anniversaryEditing" class="anniversary-edit">
            <el-date-picker
              v-model="anniversaryDraft"
              type="date"
              value-format="YYYY-MM-DD"
              placeholder="选择日期"
              :disabled-date="isFutureDate"
              size="small"
            />
            <el-button size="small" type="primary" :loading="busy === 'anniversary'" @click="saveAnniversary(anniversaryDraft || null)">保存</el-button>
            <el-button size="small" @click="anniversaryEditing = false">取消</el-button>
          </div>
          <div v-else class="row-actions">
            <el-button size="small" @click="startAnniversaryEdit">{{ status.anniversary ? "修改" : "设置" }}</el-button>
            <el-button v-if="status.anniversary" size="small" text :loading="busy === 'anniversary'" @click="saveAnniversary(null)">清除</el-button>
          </div>
        </div>
        <div class="setting-row">
          <div>
            <strong>解除绑定</strong>
            <p class="muted small">解除后双方的课表快照立即删除，TA 会收到通知。</p>
          </div>
          <el-button size="small" type="danger" plain :loading="busy === 'unbind'" @click="unbind">解除绑定</el-button>
        </div>
      </article>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import UserAvatar from "@/components/common/UserAvatar.vue";
import { coupleApi, type CoupleSchedules, type CoupleStatus } from "@/api/couple";
import { useAuthStore } from "@/stores/auth";
import { copyText } from "@/utils/userGroup";
import { normalizeCalendarWeekDays, shortDate } from "@/views/schedule/calendar";
import {
  chinaClock,
  commonFreeRanges,
  createSnapshotDayReader,
  daysTogether,
  describeNow,
  nextAnniversary,
  periodsFor,
  weekNumberForDate,
  type CoupleNowStatus,
  type CoupleScheduleSnapshot,
  type FreeRange,
} from "@/views/schedule/couple";
import { rememberCoupleStatus } from "@/views/schedule/coupleSync";
import type { WeekCourseBlock } from "@/views/schedule/types";

const HeartIcon = defineComponent({
  name: "HeartIcon",
  setup: () => () => h("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" }, [
    h("path", { fill: "currentColor", d: "M12 20.3l-1.3-1.2C6 14.9 3 12.2 3 8.9 3 6.2 5.1 4 7.8 4c1.5 0 3 .7 4.2 1.9C13.2 4.7 14.7 4 16.2 4 18.9 4 21 6.2 21 8.9c0 3.3-3 6-7.7 10.2L12 20.3z" }),
  ]),
});

type Owner = "me" | "ta";
type OwnedBlock = { key: string; owner: Owner; date: string; block: WeekCourseBlock };

const route = useRoute();
const auth = useAuthStore();
const dayNames = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

const status = ref<CoupleStatus | null>(null);
const schedules = ref<CoupleSchedules | null>(null);
const loading = ref(true);
const loadError = ref("");
const busy = ref<"" | "invite" | "cancel" | "accept" | "unbind" | "anniversary">("");
const acceptCode = ref(String(route.query.code || "").slice(0, 8));
const now = ref(new Date());
const week = ref("");
const selectedKey = ref("");
const anniversaryEditing = ref(false);
const anniversaryDraft = ref("");

const today = computed(() => chinaClock(now.value).ymd);
const meSnapshot = computed<CoupleScheduleSnapshot | null>(() => schedules.value?.me ?? null);
const partnerSnapshot = computed<CoupleScheduleSnapshot | null>(() => schedules.value?.partner ?? null);
const meReader = computed(() => createSnapshotDayReader(meSnapshot.value));
const partnerReader = computed(() => createSnapshotDayReader(partnerSnapshot.value));
// 周次与日期以自己的校历为准；自己还没同步时借用 TA 的。
const baseCalendar = computed(() => meSnapshot.value?.calendar ?? partnerSnapshot.value?.calendar ?? null);
const periods = computed(() => periodsFor(baseCalendar.value));
const weekOptions = computed(() => (baseCalendar.value?.weeks ?? []).map((item) => ({ value: String(item.week), label: `第 ${item.week} 周` })));
const weekIndex = computed(() => weekOptions.value.findIndex((item) => item.value === week.value));
const prevWeek = computed(() => weekOptions.value[weekIndex.value - 1]?.value ?? "");
const nextWeek = computed(() => weekOptions.value[weekIndex.value + 1]?.value ?? "");
const weekInfo = computed(() => baseCalendar.value?.weeks.find((item) => String(item.week) === week.value) ?? null);
const weekDates = computed(() => normalizeCalendarWeekDays(weekInfo.value?.days ?? []).slice(0, 7));
const weekRangeText = computed(() => weekDates.value.length === 7 ? `${shortDate(weekDates.value[0])} - ${shortDate(weekDates.value[6])}` : "");
const gridStyle = computed(() => ({ gridTemplateRows: `42px repeat(${periods.value.length}, minmax(44px, auto))` }));

const weekBlocks = computed<OwnedBlock[]>(() => {
  const list: OwnedBlock[] = [];
  weekDates.value.forEach((date) => {
    for (const [owner, reader] of [["me", meReader.value], ["ta", partnerReader.value]] as const) {
      (reader.blocksForDate(date) ?? []).forEach((block, index) => {
        list.push({ key: `${owner}-${date}-${block.startSlot}-${index}`, owner, date, block });
      });
    }
  });
  return list;
});
const selectedItem = computed(() => weekBlocks.value.find((item) => item.key === selectedKey.value) ?? null);

const freeByDay = computed(() => {
  if (!meSnapshot.value || !partnerSnapshot.value) return [];
  return weekDates.value.flatMap((date, index) => {
    const mine = meReader.value.blocksForDate(date);
    const theirs = partnerReader.value.blocksForDate(date);
    const ranges = commonFreeRanges(index + 1, mine, theirs, periods.value);
    if (!ranges) return [];
    return [{ date, day: index + 1, ranges, allDay: !mine?.length && !theirs?.length }];
  });
});
// 全天都空的日子（通常是周末）不铺满绿色，免得把真正有用的空档淹没。
const weekFreeRanges = computed<FreeRange[]>(() => freeByDay.value.filter((item) => !item.allDay).flatMap((item) => item.ranges));

const togetherDays = computed(() => status.value?.status === "active" ? daysTogether(status.value.anniversary, today.value) : null);
const upcomingAnniversary = computed(() => {
  if (status.value?.status !== "active") return null;
  const next = nextAnniversary(status.value.anniversary, today.value);
  return next && next.daysLeft <= 30 ? next : null;
});

const inviteExpiresText = computed(() => {
  if (status.value?.status !== "pending" || !status.value.invite.expiresAt) return "";
  return `将于 ${formatDateTime(status.value.invite.expiresAt)}`;
});

const nowCards = computed(() => {
  if (status.value?.status !== "active") return [];
  return [
    { key: "ta" as const, ...describeCard(describeNow(partnerSnapshot.value, now.value)), synced: partnerSnapshot.value ? formatRelative(partnerSnapshot.value.syncedAt) : "" },
    { key: "me" as const, ...describeCard(describeNow(meSnapshot.value, now.value)), synced: meSnapshot.value ? formatRelative(meSnapshot.value.syncedAt) : "" },
  ];
});

function describeCard(value: CoupleNowStatus) {
  const place = (location?: string) => location ? ` · ${location}` : "";
  switch (value.kind) {
    case "no-data": return { title: "还没有同步课表", detail: "" };
    case "out-of-term": return { title: "今天不在学期内", detail: "" };
    case "free-day": return { title: "今天没有课", detail: "" };
    case "in-class": return {
      title: `正在上《${value.current.course.name}》`,
      detail: `${value.current.end} 下课${place(value.current.course.location)}${value.next ? `，下一节 ${value.next.start}` : "，之后没课了"}`,
    };
    case "between": return {
      title: `下一节《${value.next.course.name}》`,
      detail: `${value.next.start} 开始${place(value.next.course.location)}`,
    };
    case "done": return { title: "今天的课都上完了", detail: `今天共 ${value.doneCount} 节课` };
  }
}

function rangeStyle(day: number, startSlot: number, endSlot: number, owner: Owner | "both") {
  const rowOf = (slot: number) => periods.value.findIndex((item) => item.no === slot) + 2;
  const start = rowOf(startSlot);
  const end = rowOf(endSlot);
  const column = day * 2;
  return {
    gridColumn: owner === "both" ? `${column} / span 2` : `${owner === "me" ? column : column + 1}`,
    gridRow: `${Math.max(2, start)} / ${Math.max(start, end) + 1}`,
  };
}

function blockTitle(item: OwnedBlock) {
  const course = item.block.course;
  const first = periods.value.find((period) => period.no === item.block.startSlot);
  const last = periods.value.find((period) => period.no === item.block.endSlot);
  const time = course.customStartTime && course.customEndTime
    ? `${course.customStartTime}-${course.customEndTime}`
    : first && last ? `${first.start}-${last.end}` : "";
  return [
    `${dayNames[item.block.day - 1]} ${item.block.startSlot}-${item.block.endSlot} 节`,
    time,
    course.location ? `@${course.location}` : "",
    course.teacher || "",
  ].filter(Boolean).join(" · ");
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatRelative(value: string) {
  const diff = now.value.getTime() - new Date(value).getTime();
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return formatDateTime(value);
}

function isFutureDate(date: Date) {
  return date.getTime() > Date.now();
}

function applyStatus(next: CoupleStatus) {
  status.value = next;
  rememberCoupleStatus(auth.user?.id, next.status);
}

function pickInitialWeek() {
  const calendar = baseCalendar.value;
  if (!calendar) return;
  const current = weekNumberForDate(calendar, today.value) ?? calendar.currentWeek ?? calendar.weeks[0]?.week;
  const clamped = calendar.weeks.some((item) => item.week === current) ? current : calendar.weeks[0]?.week;
  week.value = clamped ? String(clamped) : "";
}

async function loadSchedules() {
  schedules.value = status.value?.status === "active" ? await coupleApi.schedules() : null;
  if (!weekOptions.value.some((item) => item.value === week.value)) pickInitialWeek();
}

async function refreshAll() {
  loading.value = true;
  loadError.value = "";
  try {
    applyStatus(await coupleApi.status());
    await loadSchedules();
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : "情侣课表加载失败";
  } finally {
    loading.value = false;
  }
}

async function run(kind: typeof busy.value, task: () => Promise<CoupleStatus>, success?: string) {
  if (busy.value) return;
  busy.value = kind;
  try {
    applyStatus(await task());
    await loadSchedules();
    if (success) ElMessage.success(success);
  } catch {
    // 请求层已经提示了具体错误。
  } finally {
    busy.value = "";
  }
}

const createInvite = () => run("invite", coupleApi.invite);
const cancelInvite = () => run("cancel", coupleApi.cancelInvite);

async function acceptInvite() {
  const code = acceptCode.value.trim();
  if (!code) return;
  await run("accept", () => coupleApi.accept(code));
  if (status.value?.status === "active") {
    acceptCode.value = "";
    ElMessage.success(`已和 ${status.value.partner.nickname} 绑定`);
  }
}

async function copyInvite() {
  if (status.value?.status !== "pending" || !status.value.invite.code) return;
  const code = status.value.invite.code;
  const link = `${window.location.origin}/schedule/couple?code=${code}`;
  await copyText(`我们来绑定情侣课表吧！邀请码 ${code}，24 小时内有效。打开 ${link} 就能绑定。`);
  ElMessage.success("邀请已复制，发给 TA 吧");
}

function startAnniversaryEdit() {
  anniversaryDraft.value = status.value?.status === "active" ? status.value.anniversary ?? "" : "";
  anniversaryEditing.value = true;
}

async function saveAnniversary(value: string | null) {
  await run("anniversary", () => coupleApi.setAnniversary(value), value ? "纪念日已保存" : "纪念日已清除");
  anniversaryEditing.value = false;
}

async function unbind() {
  if (status.value?.status !== "active") return;
  try {
    await ElMessageBox.confirm(
      `确定解除和 ${status.value.partner.nickname} 的情侣课表绑定吗？双方的课表快照会立即删除，纪念日设置也会清除。`,
      "解除绑定",
      { confirmButtonText: "解除", cancelButtonText: "再想想", type: "warning" },
    );
  } catch {
    return;
  }
  await run("unbind", coupleApi.unbind, "已解除绑定");
}

watch(week, () => { selectedKey.value = ""; });

let clockTimer = 0;
let pendingPollTimer = 0;
onMounted(() => {
  void refreshAll();
  clockTimer = window.setInterval(() => { now.value = new Date(); }, 30_000);
  // 等待对方接受邀请时轮询，让邀请方页面自动切换到绑定后的样子。
  pendingPollTimer = window.setInterval(async () => {
    if (status.value?.status !== "pending" || busy.value || document.visibilityState !== "visible") return;
    try {
      const next = await coupleApi.status(true);
      if (next.status !== "pending") {
        applyStatus(next);
        await loadSchedules();
        if (next.status === "active") ElMessage.success(`${next.partner.nickname} 接受了你的邀请`);
      }
    } catch { /* 下一轮再试 */ }
  }, 15_000);
});
onBeforeUnmount(() => {
  window.clearInterval(clockTimer);
  window.clearInterval(pendingPollTimer);
});
</script>

<style scoped>
.couple-page {
  --couple-me: var(--cpu-primary);
  --couple-ta: #e2568a;
  --couple-free: #2f9e68;
  min-height: 100vh;
  padding: 28px max(16px, 4vw) 48px;
  background: var(--cpu-bg);
  color: var(--cpu-text);
}
.couple-head, .couple-body { max-width: 1180px; margin: 0 auto; }
.couple-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
.couple-head h1 { margin: 0; font-size: 28px; }
.eyebrow { margin: 0 0 5px; color: var(--couple-ta); font-size: 12px; font-weight: 700; letter-spacing: .04em; }
.muted { margin: 6px 0 0; color: var(--cpu-text-secondary); font-size: 13px; line-height: 1.6; }
.small { font-size: 12px; }
.panel { padding: 18px; border: 1px solid var(--cpu-border); border-radius: 14px; background: var(--cpu-card); box-shadow: var(--cpu-shadow-sm); }
.panel h2 { margin: 0 0 6px; font-size: 17px; }
.row-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 12px; }
.tag { display: inline-flex; align-items: center; padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; color: #fff; }
.tag.me { background: var(--couple-me); }
.tag.ta { background: var(--couple-ta); }

.bind-layout { display: grid; grid-template-columns: 1.2fr 1fr 1fr; gap: 16px; align-items: start; }
.bind-intro ul { margin: 10px 0; padding-left: 18px; line-height: 1.9; font-size: 14px; }
.intro-hearts { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.intro-hearts .dot { width: 14px; height: 14px; border-radius: 50%; }
.dot.me { background: var(--couple-me); }
.dot.ta { background: var(--couple-ta); }
.intro-heart { width: 22px; height: 22px; color: var(--couple-ta); }
.invite-code { margin: 14px 0 4px; font: 700 34px/1.2 var(--cpu-font-mono, ui-monospace, monospace); letter-spacing: .18em; color: var(--couple-ta); }
.waiting { display: flex; align-items: center; gap: 8px; margin: 14px 0 0; color: var(--cpu-text-secondary); font-size: 13px; }
.pulse { width: 8px; height: 8px; border-radius: 50%; background: var(--couple-ta); animation: pulse 1.6s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: .25; } }
.accept-form { display: flex; gap: 8px; margin-top: 12px; }
.code-input :deep(input) { font-family: var(--cpu-font-mono, ui-monospace, monospace); letter-spacing: .12em; text-transform: uppercase; }
.code-input :deep(input::placeholder) { font-family: var(--cpu-font-sans, inherit); letter-spacing: normal; text-transform: none; }

.hero { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 12px; }
.hero-person { display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 0; }
.hero-person strong { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hero-center { display: flex; flex-direction: column; align-items: center; text-align: center; }
.hero-heart { width: 34px; height: 34px; color: var(--couple-ta); animation: beat 2.4s ease-in-out infinite; }
@keyframes beat { 0%, 60%, 100% { transform: scale(1); } 30% { transform: scale(1.12); } }
@media (prefers-reduced-motion: reduce) { .hero-heart, .pulse { animation: none; } }
.together { margin: 6px 0 0; font-size: 15px; }
.together b { color: var(--couple-ta); font-size: 22px; }

.now-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px; }
.now-card { border-left: 4px solid var(--couple-me); }
.now-card.ta { border-left-color: var(--couple-ta); }
.now-card header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.now-card strong { display: block; font-size: 16px; }
.notice { margin-top: 12px; }
.notice a { color: var(--cpu-primary); }

.sheet { margin-top: 12px; }
.sheet-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
.week-nav { display: flex; align-items: center; gap: 6px; }
.nav-btn { display: inline-grid; place-items: center; width: 28px; height: 28px; padding: 0; border: 1px solid var(--cpu-border); border-radius: 50%; background: var(--cpu-card); color: var(--cpu-text); font-size: 18px; line-height: 1; cursor: pointer; }
.nav-btn:disabled { opacity: .4; cursor: not-allowed; }
.week-range { color: var(--cpu-text-secondary); font-size: 12px; white-space: nowrap; }
.week-select { width: 110px; }
.legend { display: flex; gap: 14px; color: var(--cpu-text-secondary); font-size: 12px; }
.legend span { display: inline-flex; align-items: center; gap: 5px; }
.swatch { width: 12px; height: 12px; border-radius: 3px; }
.swatch.me { background: color-mix(in srgb, var(--couple-me) 35%, var(--cpu-card)); }
.swatch.ta { background: color-mix(in srgb, var(--couple-ta) 35%, var(--cpu-card)); }
.swatch.free { background: color-mix(in srgb, var(--couple-free) 22%, var(--cpu-card)); border: 1px dashed var(--couple-free); }

.grid-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
.couple-grid {
  position: relative;
  display: grid;
  grid-template-columns: 50px repeat(14, minmax(38px, 1fr));
  min-width: 620px;
  border-top: 1px solid var(--cpu-border);
  border-left: 1px solid var(--cpu-border);
}
.grid-head, .slot-axis, .grid-cell { min-width: 0; border-right: 1px solid var(--cpu-border); border-bottom: 1px solid var(--cpu-border); }
.grid-head { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; background: var(--cpu-surface-soft); font-size: 12px; }
.grid-head small, .slot-axis small { color: var(--cpu-text-secondary); font-size: 10px; }
.grid-head.today { background: color-mix(in srgb, var(--cpu-primary) 14%, var(--cpu-card)); }
.slot-axis { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px; background: var(--cpu-surface-soft); color: var(--cpu-text-secondary); font-size: 11px; }
.grid-cell.today { background: color-mix(in srgb, var(--cpu-primary) 5%, var(--cpu-card)); }
.free-block {
  z-index: 1;
  margin: 2px;
  border: 1px dashed color-mix(in srgb, var(--couple-free) 70%, transparent);
  border-radius: 7px;
  background: color-mix(in srgb, var(--couple-free) 14%, transparent);
  pointer-events: auto;
}
.course-block {
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  margin: 2px;
  padding: 4px 5px;
  border: 0;
  border-radius: 7px;
  color: var(--cpu-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
}
.course-block.me { background: color-mix(in srgb, var(--couple-me) 22%, var(--cpu-card)); box-shadow: inset 3px 0 0 var(--couple-me); }
.course-block.ta { background: color-mix(in srgb, var(--couple-ta) 20%, var(--cpu-card)); box-shadow: inset -3px 0 0 var(--couple-ta); }
.course-block.selected { outline: 2px solid var(--cpu-text); outline-offset: -1px; }
.course-block strong { display: -webkit-box; font-size: 11px; line-height: 1.3; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 3; word-break: break-all; }
.course-block span { font-size: 10px; color: var(--cpu-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.course-detail { display: flex; align-items: flex-start; gap: 10px; margin-top: 12px; padding: 12px; border-radius: 10px; background: var(--cpu-surface-soft); }
.course-detail p { margin: 2px 0 0; }

.free-list { margin-top: 16px; }
.free-list h3 { margin: 0 0 8px; font-size: 15px; }
.free-list ul { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
.free-list li { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 6px 0; border-bottom: 1px dashed var(--cpu-border); }
.free-list li.today .free-day { color: var(--cpu-primary); }
.free-day { width: 72px; font-weight: 700; font-size: 13px; }
.free-day small { color: var(--cpu-text-secondary); font-weight: 400; }
.chip { display: inline-flex; align-items: baseline; gap: 5px; padding: 3px 9px; border-radius: 999px; background: color-mix(in srgb, var(--couple-free) 14%, var(--cpu-card)); color: var(--cpu-text); font-size: 12px; }
.chip small { color: var(--cpu-text-secondary); font-size: 10px; }

.settings { margin-top: 12px; }
.setting-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 0; border-top: 1px solid var(--cpu-border-soft, var(--cpu-border)); }
.setting-row:first-of-type { border-top: 0; }
.setting-row p { margin: 2px 0 0; }
.anniversary-edit { display: flex; flex-wrap: wrap; gap: 6px; }

@media (max-width: 900px) {
  .bind-layout { grid-template-columns: 1fr; }
}
@media (max-width: 640px) {
  .couple-page { padding: 18px 16px 40px; }
  .couple-head { align-items: flex-start; }
  .couple-head h1 { font-size: 23px; }
  .panel { padding: 14px; }
  .now-grid { grid-template-columns: 1fr; }
  .hero { gap: 6px; }
  .setting-row { flex-direction: column; align-items: flex-start; }
}
</style>
