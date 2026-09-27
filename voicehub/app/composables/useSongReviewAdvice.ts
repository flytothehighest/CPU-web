import { onMounted, onUnmounted, ref, watch, type Ref } from 'vue'

type Advice = { songId: number; status: string; message: string; detail: string; reviewToken: string | null; requiresConfirmation: boolean; confirmedAt: string | null; expiresAt: string | null; expired: boolean }
export function useSongReviewAdvice(userId: Ref<number | null>) {
  const apiBase = String(useRuntimeConfig().public.apiBase || '/api').replace(/\/$/, '')
  const advice = ref<Record<number, Advice>>({})
  const actionErrors = ref<Record<number, string>>({})
  const acting = ref<number[]>([])
  let timer: ReturnType<typeof setInterval>
  let disposed = false
  let pending = false
  async function refresh() {
    if (!userId.value || pending || disposed || document.hidden) return
    const requester = userId.value
    pending = true
    try {
      const result = await $fetch<{ enabled: boolean; reviews: Advice[] }>(`${apiBase}/songs/review-status`)
      if (!disposed && userId.value === requester) advice.value = Object.fromEntries(result.reviews.map(r => [r.songId, r]))
    } catch { /* Advice availability never changes submission success or the song list. */ }
    finally { pending = false }
  }
  async function act(item: Advice, action: 'confirm' | 'withdraw') {
    if (!item.requiresConfirmation || !item.reviewToken || item.expired || acting.value.includes(item.songId)) return false
    acting.value.push(item.songId)
    actionErrors.value[item.songId] = ''
    try {
      await $fetch(`${apiBase}/songs/review-action`, { method: 'POST', body: { songId: item.songId, reviewToken: item.reviewToken, action, acknowledged: true } })
      await refresh()
      return true
    } catch (e: any) {
      actionErrors.value[item.songId] = e?.data?.message || e?.data?.statusMessage || '操作失败，请刷新后重试'
      return false
    } finally { acting.value = acting.value.filter(id => id !== item.songId) }
  }
  watch(userId, () => { advice.value = {}; if (import.meta.client) void refresh() })
  onMounted(() => { void refresh(); timer = setInterval(() => void refresh(), 15_000) })
  onUnmounted(() => { disposed = true; clearInterval(timer) })
  return { advice, refresh, act, acting, actionErrors }
}
