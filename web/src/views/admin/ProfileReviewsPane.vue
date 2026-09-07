<template>
  <section class="cpu-card">
    <h3>资料审核</h3>
    <p>检查昵称、头像、简介及院系，拒绝色情、骚扰、诈骗、泄露隐私及冒充身份。优先处理超过 24 小时的提交。</p>
    <el-button :loading="loading" @click="load">刷新资料队列</el-button>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <article v-for="row in rows" :key="row.id" class="review-row">
      <strong>{{ row.nickname || '新用户' }} · #{{ row.id }}</strong>
      <el-tag v-if="Date.now() - Date.parse(row.updatedAt) > 86400000" type="danger">已超过 24 小时</el-tag>
      <img v-if="pending(row).avatar" :src="pending(row).avatar" alt="待审核头像" width="80" height="80" />
      <pre>{{ { ...pending(row), avatar: pending(row).avatar ? '见头像预览' : null } }}</pre>
      <el-button :disabled="busy" type="success" @click="decide(row, true)">通过</el-button>
      <el-button :disabled="busy" type="danger" @click="decide(row, false)">驳回</el-button>
    </article>
    <el-empty v-if="!loading && !rows.length" description="暂无待审核资料" />
  </section>
</template>
<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { ElMessageBox, ElMessage } from 'element-plus';
import { request } from '@/api/request';
type Row = { id: number; nickname: string; pendingProfile: string; updatedAt: string };
const rows = ref<Row[]>([]), loading = ref(false), busy = ref(false), error = ref('');
function pending(row: Row) { try { return JSON.parse(row.pendingProfile); } catch { return {}; } }
async function load() { loading.value = true; error.value = ''; try { rows.value = await request.get<Row[]>('/admin/profile-reviews', undefined, { cacheTtlMs: 0 }); } catch { error.value = '资料审核队列读取失败，请重试'; } finally { loading.value = false; } }
async function decide(row: Row, approve: boolean) {
  let note = '';
  try { ({ value: note } = await ElMessageBox.prompt(approve ? '确认资料符合社区规则，可填写说明' : '请说明不通过原因，用户将收到此说明', approve ? '通过资料' : '驳回资料', { inputValidator: (value: string) => approve || Boolean(value?.trim()) || '请填写原因' })); } catch { return; }
  busy.value = true;
  try { await request.post(`/admin/profile-reviews/${row.id}`, { approve, snapshot: row.pendingProfile, note: note.trim() }); ElMessage.success('已处理'); await load(); } finally { busy.value = false; }
}
onMounted(load);
</script>
<style scoped>.review-row { border-top: 1px solid var(--cpu-border-soft); padding: 16px 0; } img { display: block; object-fit: contain; margin-top: 10px; } pre { white-space: pre-wrap; overflow-wrap: anywhere; } p { color: var(--cpu-text-secondary); }</style>
