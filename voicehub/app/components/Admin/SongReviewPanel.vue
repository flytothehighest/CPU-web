<template>
  <section class="rounded-xl border border-zinc-700 bg-zinc-900/40 p-4 space-y-3" :aria-busy="busy">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 class="text-base font-bold text-zinc-100">歌曲审核</h3>
        <p class="text-sm text-zinc-400">{{ config?.enabled ? 'AI无风险或用户阅读建议后确认，才进入待排期；建议送达24小时未确认自动撤回。' : '在主站管理后台 → AI 配置中启用歌曲审核，并选择专用服务和模型。' }}</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button class="review-button" :disabled="busy || !config?.enabled || !selected.length" @click="reviewBatch(selected)">AI审核所选（{{ selected.length }}）</button>
        <button class="review-button" :disabled="busy || !config?.enabled || !pendingIds.length" @click="reviewBatch(pendingIds.slice(0, 50))">审核待审歌曲（最多50首）</button>
        <button class="review-button" :disabled="busy" @click="refresh">刷新审核状态</button>
        <button v-if="busy" class="review-button" @click="stopRequested = true" :disabled="stopRequested">{{ stopRequested ? '当前歌曲完成后停止' : '停止后续审核' }}</button>
      </div>
    </div>
    <p v-if="error" role="alert" class="text-sm text-red-300">{{ error }}</p>
    <p role="status" aria-live="polite" class="text-sm text-zinc-300">{{ progress || `待审 ${pendingIds.length} 首 · AI暂无法确认 ${uncertainCount} 首` }}</p>
    <dialog ref="dialog" class="review-dialog rounded-xl border border-zinc-700 bg-zinc-900 text-zinc-100 p-5" @close="active = null">
      <template v-if="active">
        <div class="flex items-start justify-between gap-3">
          <h3 class="text-lg font-bold">{{ active.title }} · {{ active.artist }}</h3>
          <button class="review-button" @click="dialog?.close()" aria-label="关闭歌曲审核详情">关闭</button>
        </div>
        <p class="mt-4 text-sm">{{ activeReview.confirmedAt ? '用户已确认继续投稿' : labels[activeReview.status || 'pending'] || '待审核' }}<span v-if="activeReview.model"> · {{ activeReview.model }}</span></p>
        <p class="my-3 whitespace-pre-wrap break-words text-sm text-zinc-300">{{ activeReview.reason }}</p>
        <ul v-if="activeReview.sources?.length" class="space-y-2 my-3">
          <li v-for="source in safeSources" :key="source.url"><a :href="source.url" target="_blank" rel="noopener noreferrer" class="text-sm text-blue-300 underline break-all">{{ source.title || source.url }}</a></li>
        </ul>
        <p class="text-xs text-zinc-400">AI依据歌词及公开来源审核。证据不足或调用失败时暂不放行，调用失败最多自动尝试3次。有建议时由投稿人确认或撤回，管理员不能代替确认。</p>
        <div class="flex flex-wrap gap-2 mt-4">
          <button class="review-button" :disabled="busy || !config?.enabled" @click="reviewBatch([active.id])">重新AI审核</button>
        </div>
      </template>
    </dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
type Song = { id: number; title: string; artist: string; played?: boolean }
type Review = { songId: number; status: string; reason: string; model?: string; fingerprint: string; policyVersion: string; sources: Array<{ title: string; url: string }>; confirmedAt?: string | null }
const apiBase = String(useRuntimeConfig().public.apiBase || '/api').replace(/\/$/, '')
const props = defineProps<{ songs: Song[]; selected: number[] }>()
const emit = defineEmits<{ updated: [Record<number, Review>] }>()
const labels: Record<string, string> = { pending: '待审核', checking: '审核中', approved: '审核通过', rejected: '审核不通过', uncertain: 'AI暂无法确认', error: '调用失败' }
const reviews = ref<Record<number, Review>>({})
const config = ref<{ enabled: boolean; policyVersion: string } | null>(null)
const error = ref('')
const progress = ref('')
const busy = ref(false)
const stopRequested = ref(false)
const dialog = ref<HTMLDialogElement>()
const active = ref<Song | null>(null)
const pendingIds = computed(() => props.songs.filter(s => !s.played && (!reviews.value[s.id] || reviews.value[s.id]?.status === 'pending')).map(s => s.id))
const uncertainCount = computed(() => props.songs.filter(s => ['uncertain', 'error'].includes(reviews.value[s.id]?.status || '')).length)
const activeReview = computed(() => active.value && reviews.value[active.value.id] || { status: 'pending', reason: '等待审核', sources: [] } as Partial<Review>)
const safeSources = computed(() => (activeReview.value.sources || []).filter(s => /^https?:\/\//i.test(s.url)))
let disposed = false
let timer: ReturnType<typeof setInterval>
const message = (e: any) => e?.data?.message || e?.data?.statusMessage || e?.message || '请求失败，请重试'

async function refresh() {
  try {
    const result = await $fetch<{ config: NonNullable<typeof config.value>; reviews: Review[] }>(`${apiBase}/admin/songs/reviews`)
    if (disposed) return
    config.value = result.config
    reviews.value = Object.fromEntries(result.reviews.map(r => [r.songId, r]))
    emit('updated', reviews.value)
    error.value = ''
  } catch (e) { error.value = `无法读取审核状态：${message(e)}`; config.value = null }
}
function open(song: Song) {
  active.value = { ...song }
  dialog.value?.showModal()
}
async function reviewBatch(ids: number[]) {
  if (busy.value) return
  busy.value = true
  stopRequested.value = false
  let completed = 0
  let failures = 0
  try {
    for (const id of [...new Set(ids)].slice(0, 50)) {
      if (disposed || stopRequested.value) break
      progress.value = `正在审核第 ${completed + 1} / ${Math.min(ids.length, 50)} 首，请稍候…`
      try { await $fetch(`${apiBase}/admin/songs/review`, { method: 'POST', body: { action: 'ai', songId: id } }) }
      catch (e) { failures++; error.value = message(e) }
      completed++
      await refresh()
    }
    progress.value = `本轮已处理 ${completed} 首${failures ? `，${failures} 首请求失败` : ''}。请查看每首歌曲的审核结果。`
  } finally { busy.value = false }
}
onMounted(() => { refresh(); timer = setInterval(() => { if (!busy.value) refresh() }, 15_000) })
onUnmounted(() => { disposed = true; stopRequested.value = true; clearInterval(timer) })
defineExpose({ open, refresh })
</script>

<style scoped>
.review-button { min-height: 44px; padding: 8px 12px; border: 1px solid #52525b; border-radius: 8px; font-size: 13px; color: #e4e4e7; background: #27272a; }
.review-button:hover:not(:disabled) { background: #3f3f46; }
.review-button:focus-visible { outline: 2px solid #60a5fa; outline-offset: 3px; }
.review-button:disabled { opacity: .45; cursor: not-allowed; }
.review-dialog { width: min(640px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); overflow: auto; }
.review-dialog::backdrop { background: rgb(0 0 0 / 65%); }
</style>
