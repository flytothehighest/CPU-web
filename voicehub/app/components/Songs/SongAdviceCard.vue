<template>
  <div class="song-advice-entry" @click.stop>
    <span class="song-advice-status">{{ advice.requiresConfirmation ? '有选曲建议，等待你确认' : advice.message }}</span>
    <button class="advice-open" @click.stop="openAdvice">{{ advice.requiresConfirmation ? '查看并处理' : '查看详情' }}</button>
  </div>
  <dialog ref="dialog" class="song-advice-dialog" :aria-labelledby="titleId" :aria-busy="busy" @click.stop>
    <div class="advice-dialog-header">
      <h3 :id="titleId">{{ advice.requiresConfirmation ? '请确认这次投稿' : '选曲建议' }}</h3>
      <button class="advice-close" aria-label="关闭选曲建议" @click="closeAdvice">关闭</button>
    </div>
    <div class="advice-dialog-content">
      <p v-if="songTitle" class="advice-song">{{ songTitle }}</p>
      <h4 class="advice-heading">{{ advice.message }}</h4>
      <p class="advice-detail">{{ advice.detail }}</p>
      <template v-if="advice.requiresConfirmation">
        <p v-if="advice.expiresAt" class="advice-deadline">请在 <strong>{{ deadline }}</strong>（北京时间）前确认。逾期未确认，系统将自动撤回。</p>
        <p v-else class="advice-deadline">主站通知正在送达，送达后开始24小时确认计时。</p>
        <p v-if="advice.expired" role="status">确认期限已过，投稿将自动撤回。</p>
      </template>
      <p v-if="busy" role="status">正在处理，请稍候…</p>
      <p v-if="error" role="alert" class="advice-error">{{ error }}</p>
    </div>
    <div class="advice-dialog-footer">
      <template v-if="advice.requiresConfirmation">
        <button class="advice-confirm" :disabled="busy || advice.expired || !advice.expiresAt" @click.stop="emit('action', 'confirm')">我已了解，仍要投稿</button>
        <button class="advice-withdraw" :disabled="busy || advice.expired" @click.stop="emit('action', 'withdraw')">撤回投稿</button>
      </template>
      <button v-else class="advice-confirm" @click="closeAdvice">知道了</button>
    </div>
  </dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, useId } from 'vue'
const props = defineProps<{ advice: { message: string; detail: string; requiresConfirmation: boolean; expiresAt: string | null; expired: boolean }; songTitle?: string; busy?: boolean; error?: string }>()
const emit = defineEmits<{ action: ['confirm' | 'withdraw'] }>()
const titleId = `song-advice-${useId()}`
const dialog = ref<HTMLDialogElement>()
const deadline = computed(() => props.advice.expiresAt ? new Date(props.advice.expiresAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '')
async function openAdvice() {
  await nextTick()
  if (!dialog.value?.open) dialog.value?.showModal()
}
function closeAdvice() { dialog.value?.close() }
</script>

<style scoped>
.song-advice-entry { box-sizing: border-box; display: flex; align-items: center; flex-wrap: wrap; gap: 10px; width: 100%; min-width: 0; padding: 12px 16px; border-top: 1px solid #d2deca; background: #f1f6ed; color: #263c2c; }
.song-advice-status { flex: 1 1 150px; min-width: 0; font-size: 14px; line-height: 1.5; overflow-wrap: anywhere; }
.advice-open, .advice-close { min-height: 44px; padding: 8px 12px; border: 1px solid #426a49; border-radius: 8px; background: #fff; color: #284f32; font: inherit; font-size: 14px; font-weight: 700; cursor: pointer; }
.song-advice-dialog { position: fixed; inset: 0; box-sizing: border-box; width: min(620px, calc(100vw - 32px)); max-width: calc(100vw - 32px); max-height: calc(100dvh - 32px); margin: auto; padding: 0; border: 1px solid #c6d4bf; border-radius: 16px; background: #fffdf8; color: #263c2c; text-align: left; box-shadow: 0 16px 60px rgb(20 40 24 / 25%); overflow: hidden; }
dialog.song-advice-dialog[open] { margin: auto; display: flex; flex-direction: column; }
.song-advice-dialog::backdrop { background: rgb(15 28 19 / 48%); }
.advice-dialog-header { display: flex; flex: 0 0 auto; align-items: center; justify-content: space-between; gap: 16px; padding: 18px 24px; border-bottom: 1px solid #dbe5d5; }
.advice-dialog-header h3 { margin: 0; font-size: 20px; font-weight: 700; line-height: 1.4; }
.advice-dialog-content { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 20px 24px; overscroll-behavior: contain; overflow-wrap: anywhere; }
.advice-dialog-content p { margin: 12px 0 0; font-size: 16px; line-height: 1.7; white-space: pre-wrap; }
.advice-dialog-content .advice-song { margin: 0 0 16px; color: #586c59; font-size: 14px; }
.advice-heading { margin: 0; font-size: 18px; font-weight: 700; line-height: 1.5; color: #704b12; }
.advice-deadline { padding: 12px 14px; border: 1px solid #d9dfcb; border-radius: 10px; background: #f1f5e9; }
.advice-error { color: #a32e2e; }
.advice-dialog-footer { display: flex; flex: 0 0 auto; flex-wrap: wrap; gap: 10px; padding: 16px 24px; border-top: 1px solid #dbe5d5; background: #f7faf3; }
.advice-dialog-footer button { min-height: 48px; padding: 10px 16px; border: 1px solid #426a49; border-radius: 8px; font: inherit; font-size: 16px; font-weight: 700; line-height: 1.5; cursor: pointer; white-space: normal; }
.advice-confirm { flex: 1 1 220px; background: #356442; color: #fff; }
.advice-withdraw { flex: 1 1 120px; background: #fff; color: #354a3b; }
.advice-confirm:hover:not(:disabled) { background: #284f32; }
.advice-withdraw:hover:not(:disabled), .advice-open:hover, .advice-close:hover { background: #e7eee3; }
.advice-dialog-footer button:disabled { opacity: .5; cursor: not-allowed; }
button:focus-visible { outline: 3px solid #254e32; outline-offset: 3px; }
@media (max-width: 480px) {
  .advice-dialog-header { padding: 14px 16px; }
  .advice-dialog-content { padding: 16px; }
  .advice-dialog-footer { padding: 14px 16px max(14px, env(safe-area-inset-bottom)); }
}
</style>
