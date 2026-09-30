import { computed, ref, shallowRef } from "vue";
import { coupleApi, type CoupleStatus } from "@/api/couple";
import { chinaClock, createSnapshotDayReader, daysTogether, describeNow, type CoupleScheduleSnapshot } from "./couple";
import { readCachedCoupleStatus, rememberCoupleStatus } from "./coupleSync";

const VISIBLE_KEY = "cpu-couple-overlay-visible-v1";

function readVisible() {
  try { return localStorage.getItem(VISIBLE_KEY) !== "0"; } catch { return true; }
}

/**
 * 课表页里的情侣叠加层：绑定状态、TA 的课表快照、是否在网格里显示 TA 的课。
 * 所有请求都静默失败，情侣功能不能影响课表本身。
 */
export function useCoupleOverlay(userId: () => number | null | undefined) {
  const status = ref<CoupleStatus | null>(null);
  const partner = shallowRef<CoupleScheduleSnapshot | null>(null);
  const visible = ref(readVisible());
  const dialogOpen = ref(false);
  const now = ref(new Date());
  let clockTimer = 0;

  const bound = computed(() => status.value?.status === "active");
  const active = computed(() => bound.value && visible.value && Boolean(partner.value));
  const partnerReader = computed(() => createSnapshotDayReader(partner.value));
  const today = computed(() => chinaClock(now.value).ymd);
  const partnerNow = computed(() => describeNow(partner.value, now.value));
  const togetherDays = computed(() => status.value?.status === "active" ? daysTogether(status.value.anniversary, today.value) : null);

  function applyStatus(next: CoupleStatus) {
    status.value = next;
    rememberCoupleStatus(userId(), next.status);
    if (next.status !== "active") partner.value = null;
  }

  async function loadSchedules() {
    if (!bound.value) return;
    partner.value = (await coupleApi.schedules()).partner;
  }

  /** 课表页打开时调用；未绑定且缓存未过期时不发请求。 */
  async function refresh(force = false) {
    const id = userId();
    if (!id) {
      status.value = null;
      return;
    }
    if (!force && readCachedCoupleStatus(id) === "none") {
      status.value = { status: "none" };
      return;
    }
    try {
      applyStatus(await coupleApi.status(true));
      await loadSchedules();
    } catch { /* 下次打开课表再试 */ }
  }

  async function run(task: () => Promise<CoupleStatus>) {
    applyStatus(await task());
    await loadSchedules().catch(() => undefined);
    return status.value;
  }

  function setVisible(value: boolean) {
    visible.value = value;
    try { localStorage.setItem(VISIBLE_KEY, value ? "1" : "0"); } catch { /* ignore */ }
  }

  function start() {
    stop();
    now.value = new Date();
    clockTimer = window.setInterval(() => { now.value = new Date(); }, 30_000);
  }

  function stop() {
    if (clockTimer) window.clearInterval(clockTimer);
    clockTimer = 0;
  }

  return {
    status,
    partner,
    visible,
    dialogOpen,
    now,
    bound,
    active,
    partnerReader,
    today,
    partnerNow,
    togetherDays,
    refresh,
    loadSchedules,
    run,
    applyStatus,
    setVisible,
    start,
    stop,
  };
}

export type CoupleOverlay = ReturnType<typeof useCoupleOverlay>;
