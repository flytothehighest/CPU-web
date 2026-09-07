<template>
  <main class="privacy-page" v-loading="loading">
    <h2>账号与隐私</h2>
    <p><a href="/privacy.html">隐私政策</a> · <a href="/community-rules.html">社区治理规则</a></p>
    <template v-if="auth.isLoggedIn">
      <section class="cpu-card">
        <h3>已屏蔽用户</h3>
        <p>屏蔽后不显示该账号的帖子和回复，双方无法继续私聊。匿名内容按实际账号生效，不会显示其真实身份。</p>
        <p v-if="!blocks.length">暂无屏蔽用户</p>
        <div v-for="item in blocks" :key="item.id" class="block-row"><span>{{ item.label }}</span><el-button text @click="unblock(item.id)">解除屏蔽</el-button></div>
      </section>
      <section class="cpu-card">
        <h3>永久删除账户</h3>
        <p>提交后立即停止原账户访问，系统自动清理账号资料、绑定、教务缓存、小组件凭证、AI 历史、上传文件及药苑之声身份。你发布的帖子和回复将清空并隐藏；与你相关的私聊会话（含双方消息）会删除。你创建的问卷、文件收集任务及其提交内容也会删除。请先保存需要的资料。</p>
        <p>学校账号及学校保存的数据不受影响。再次使用学校登录会创建全新的本站账户，原账户不可恢复。赞助不因注销自动退款，未使用权益和积分会失效。</p>
        <p>交易对账记录、无法回溯身份的数字关联和删除回执会按隐私政策保留；备份及第三方接收方的历史数据不等同于在线数据即时删除。任务遇到故障会自动重试，只有全部在线清理完成才显示完成。</p>
        <el-checkbox v-model="acknowledged">我已理解删除范围及不可恢复的后果</el-checkbox>
        <el-input v-model="confirmation" placeholder="请输入：删除我的账户" autocomplete="off" />
        <el-button type="danger" :loading="deleting" :disabled="!acknowledged || confirmation !== '删除我的账户'" @click="removeAccount">永久删除我的账户</el-button>
      </section>
    </template>
    <section class="cpu-card">
      <h3>查询删除进度</h3>
      <p>删除回执是查询凭证，请自行保存，不要分享给他人。</p>
      <el-input v-model="receipt" placeholder="删除回执" autocomplete="off" />
      <el-button :disabled="receipt.length !== 43" @click="checkStatus">查询进度</el-button>
      <p v-if="status">{{ status.message }}</p>
      <router-link v-if="!auth.isLoggedIn && !receipt" to="/login">登录后管理账号与隐私</router-link>
    </section>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useAuthStore } from '@/stores/auth';
import { request } from '@/api/request';
import { clearCreds } from '@/utils/credCrypto';
import { clearCommunityViewCaches } from '@/utils/privacyLocalState';
const auth = useAuthStore();
const loading = ref(false), deleting = ref(false), acknowledged = ref(false), confirmation = ref('');
const blocks = ref<Array<{ id: string; label: string }>>([]);
const receipt = ref(''), status = ref<{ message: string } | null>(null);
try { receipt.value = localStorage.getItem('cpu-account-deletion-receipt') || ''; } catch { /* Storage may be disabled. */ }
async function refresh() {
  loading.value = true;
  try {
    if (auth.isLoggedIn) {
      blocks.value = await request.get('/user/blocks');
    }
  } finally { loading.value = false; }
}
async function unblock(id: string) { await request.delete(`/user/blocks/${encodeURIComponent(id)}`); clearCommunityViewCaches(); await refresh(); }
async function checkStatus() { status.value = await request.post('/privacy/account-deletion/status', { receipt: receipt.value }); }
async function removeAccount() {
  try { await ElMessageBox.confirm('这会永久删除本站账户及上述关联数据，无法恢复。确认继续？', '最后确认', { type: 'warning', confirmButtonText: '永久删除', cancelButtonText: '取消', closeOnClickModal: false }); } catch { return; }
  deleting.value = true;
  try {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    receipt.value = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    try { localStorage.setItem('cpu-account-deletion-receipt', receipt.value); } catch { /* The visible receipt remains available for copying. */ }
    const result = await request.post<{ receipt: string }>('/privacy/account-deletion', { confirmation: confirmation.value, acknowledged: acknowledged.value, receipt: receipt.value });
    receipt.value = result.receipt;
    clearCreds();
    clearCommunityViewCaches();
    try { (window as any).CPUIOS?.clearScheduleWidget?.(); } catch { /* The server has already revoked widget credentials. */ }
    await auth.logout();
    await checkStatus();
    ElMessage.success('已提交永久删除，请保存下方回执并查询最终结果');
  } catch {
    ElMessage.warning('请求结果尚未确认，请保留下方回执并查询进度，避免重复提交');
  } finally { deleting.value = false; }
}
onMounted(refresh);
</script>

<style scoped>
.privacy-page { max-width: 760px; margin: 0 auto; padding: 20px 12px; line-height: 1.8; }
.cpu-card { margin: 18px 0; padding: 20px; }
.block-row { display:flex; justify-content:space-between; gap:16px; }
.el-input { margin: 12px 0; }
</style>
