<template>
  <details class="song-review-advice" :open="advice.requiresConfirmation" :aria-busy="busy" @click.stop>
    <summary>{{ advice.message }}</summary>
    <p>{{ advice.detail }}</p>
    <template v-if="advice.requiresConfirmation">
      <p v-if="advice.expiresAt">确认截止：{{ deadline }}（北京时间）。逾期将自动撤回。</p>
      <p v-else>主站通知送达后开始24小时确认计时。</p>
      <p v-if="advice.expired">确认期限已过，投稿将自动撤回。</p>
      <div class="review-advice-actions">
        <button :disabled="busy || advice.expired || !advice.expiresAt" @click.stop="emit('action', 'confirm')">我已了解，仍要投稿</button>
        <button :disabled="busy || advice.expired" @click.stop="emit('action', 'withdraw')">撤回投稿</button>
      </div>
      <p v-if="busy" role="status">正在处理，请稍候…</p>
      <p v-if="error" role="alert">{{ error }}</p>
    </template>
  </details>
</template>

<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{ advice: { message: string; detail: string; requiresConfirmation: boolean; expiresAt: string | null; expired: boolean }; busy?: boolean; error?: string }>()
const emit = defineEmits<{ action: ['confirm' | 'withdraw'] }>()
const deadline = computed(() => props.advice.expiresAt ? new Date(props.advice.expiresAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '')
</script>

<style scoped>
.song-review-advice { margin-top: 8px; padding: 10px 12px; border-left: 3px solid #d97706; font-size: 13px; line-height: 1.65; color: var(--text-primary, #e4e4e7); white-space: normal; }
.song-review-advice summary { cursor: pointer; padding-block: 6px; font-weight: 600; }
.song-review-advice p { margin: 6px 0; overflow-wrap: anywhere; }
.review-advice-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.review-advice-actions button { min-height: 44px; padding: 8px 12px; border: 1px solid currentColor; border-radius: 8px; background: transparent; color: inherit; }
.review-advice-actions button:disabled { opacity: .5; cursor: not-allowed; }
.review-advice-actions button:focus-visible { outline: 2px solid #60a5fa; outline-offset: 3px; }
</style>
