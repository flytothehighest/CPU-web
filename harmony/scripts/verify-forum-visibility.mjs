// Optional browser regression: run with Vite and PLAYWRIGHT_MODULE pointing to an installed Playwright package.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.TEST_ORIGIN || 'http://127.0.0.1:5187';
const output = resolve(process.env.TEST_OUTPUT || 'runtime/harmony-forum-visibility');
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const navigation = [
  ['home', '首页', '/home'], ['forum', '论坛', '/forum'],
  ['announcements', '公告', '/announcements'], ['services', '服务', '/services'],
  ['absolute-forum', '校园交流', 'https://cputime.cn/forum/b/general'],
].map(([id, label, to]) => ({ id, label, fullLabel: label, to, enabled: true, primary: true,
  showInDrawer: true, audience: 'all', icon: 'link', feature: '', requireForumAccess: false, openInNewTab: false }));
const services = [{ id: 1, name: '教务服务', url: '/jwxt', description: '校园数据', owner: '学校' },
  { id: 2, name: '隐藏的论坛服务', url: 'https://cputime.cn/forum' }];
const notices = [
  { id: 1, category: 'reply', title: '隐藏回复', content: '论坛内容', link: '/forum/topic/1' },
  { id: 2, category: 'direct-message', title: '隐藏私聊', content: '私聊内容' },
  { id: 3, category: 'system', title: '隐藏审核', content: '帖子审核通过' },
  { id: 4, category: 'service-tool', title: '文件收集提醒', content: '提交成功', link: '/services/tools/filestore' },
];
async function setup({ username = '2020240384', platform = 'harmony', width = 390 } = {}) {
  const ua = 'Mozilla/5.0 AppleWebKit/537.36 Chrome/142.0.0.0 Safari/537.36'
    + (platform === 'harmony' ? ' CPUWebHarmonyApp/22 CPUTimeNative/1'
      : platform === 'ios' ? ' CPUWebIOSApp/1 CPUTimeNative/1' : '');
  const context = await browser.newContext({ userAgent: ua, viewport: { width, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const requests = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route(origin + '/api/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api', '');
    requests.push(path + url.search);
    let data = {};
    if (path === '/user/me') data = { id: 42, username, nickname: '测试同学', role: 'user', studentSso: false,
      postCount: 18, replyCount: 20, reputation: 70, reputationLevel: { level: 3, name: '论坛达人' } };
    else if (path === '/site/features') data = { forum: true, market: true, coursereview: true,
      forumLoginRequired: false, electric: true, sponsor: false, assistantEntry: true };
    else if (path === '/site/navigation') data = navigation;
    else if (path === '/services') data = services;
    else if (path === '/home/summary') data = { identity: {}, services, pinnedTopics: [], hotTopics: [], latestTopics: [], announce: [] };
    else if (path === '/home/latest-feed') data = { list: [], pins: [], total: 0, page: 1, size: 10 };
    else if (path === '/search') data = { services, topics: [], courses: [] };
    else if (path === '/search/assistant/quota') data = { level: 3, levelName: '论坛达人', dailyQuota: 10, remaining: 10, points: 0 };
    else if (path === '/topics/smart-compose/current') data = null;
    else if (path === '/messages') data = notices;
    else if (path === '/messages/settings') data = { subscribeReply: true, subscribeLike: true, subscribeSchool: true, subscribeSystem: true };
    else if (path === '/account-verification/me') data = { verification: null, applications: [],
      submission: { limit: 3, used: 0, remaining: 3, hasPending: false } };
    else if (path.includes('qqbot') || path.includes('wechat')) data = { enabled: false, binding: null };
    else if (path === '/boards' || path === '/user/blocks' || /\/topics$/.test(path) || path.includes('forum-ads')) data = [];
    else if (path === '/jwxt/status') data = { authenticated: false };
    else if (path === '/tools') data = [];
    await route.fulfill({ json: { code: 0, data, message: '' } });
  });
  const go = async path => {
    await page.goto(origin + path);
    await page.waitForFunction(() => document.body.dataset.cpuAppReady === '1');
    await page.locator('#boot-screen').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => Array.from(document.querySelectorAll('.el-loading-mask'))
      .every(element => !element.getClientRects().length || getComputedStyle(element).visibility === 'hidden'),
    undefined, { timeout: 10000 }).catch(async error => {
      console.log(JSON.stringify({ path, errors, requests, body: await page.locator('body').innerText() }));
      await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true });
      throw error;
    });
  };
  return { page, context, requests, errors, go };
}
const forbidden = /论坛|帖子|发帖|声望|信誉与匿名|收到回复|收到点赞|QQ 投稿|仅限连接内网|隐藏私聊|隐藏审核|隐藏回复/;
try {
  for (const width of [390, 1280]) {
    const h = await setup({ width });
    await h.go('/home');
    assert.match(await h.page.locator('body').innerText(), /校园服务/);
    assert.doesNotMatch(await h.page.locator('body').innerText(), forbidden);
    assert.ok(!h.requests.some(path => path.startsWith('/home/')), JSON.stringify(h.requests));
    await h.page.screenshot({ path: resolve(output, 'home-' + width + '.png'), fullPage: true });
    for (const path of ['/profile', '/profile/privacy', '/profile/verification', '/messages',
      '/messages?tab=settings', '/search/results?q=服务']) {
      await h.go(path);
      assert.doesNotMatch(await h.page.locator('body').innerText(), forbidden, path);
      await h.page.screenshot({ path: resolve(output, path.replace(/\W+/g, '-') + '-' + width + '.png'), fullPage: true });
      if (path === '/messages') {
        await h.page.getByRole('button', { name: '全部标为已读' }).click();
        await h.page.getByText('当前全部已读', { exact: true }).waitFor();
        assert.ok(h.requests.includes('/messages/4/read'));
        assert.ok(!h.requests.includes('/messages/read-all'));
      }
    }
    assert.ok(!h.requests.some(path => path === '/boards' || /\/user\/\d+\/topics/.test(path)), JSON.stringify(h.requests));
    assert.ok(!h.requests.some(path => path.startsWith('/topics')), JSON.stringify(h.requests));
    assert.ok(h.requests.some(path => path.startsWith('/search?') && path.includes('scope=services')));
    for (const path of ['/forum/topic/1', '/coursereview/1', '/market', '/u/2', '/announcements', '/admin']) {
      await h.go(path);
      assert.ok(new URL(h.page.url()).pathname.startsWith('/home'), h.page.url());
      assert.doesNotMatch(await h.page.locator('body').innerText(), forbidden);
    }
    await h.go('/messages?tab=private&forumId=2');
    assert.equal(new URL(h.page.url()).search, '');
    assert.doesNotMatch(await h.page.locator('body').innerText(), forbidden);
    assert.deepEqual(h.errors, []);
    console.log('Restricted Harmony passed at ' + width + 'px');
    await h.context.close();
  }
  for (const [platform, username] of [['web', '2020240384'], ['harmony', '2020240385'], ['ios', '2020240384']]) {
    const h = await setup({ platform, username });
    await h.go('/home');
    const body = await h.page.locator('body').innerText();
    assert.match(body, platform === 'ios' ? /论坛仅限连接内网后使用/ : /论坛/);
    if (platform === 'harmony') {
      await h.page.evaluate(() => {
        const stores = document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s;
        const auth = stores.get('auth');
        const msg = stores.get('message');
        msg.unreadCount = 4;
        msg.directUnreadCount = 4;
        auth.applyAuthenticatedSession('__cpu_cookie_session__', { ...auth.user, id: 43, username: '2020240384' });
      });
      await h.page.waitForFunction(() => document.getElementById('app').__vue_app__
        .config.globalProperties.$router.currentRoute.value.path === '/home/services');
      assert.doesNotMatch(await h.page.locator('body').innerText(), forbidden);
      assert.equal(await h.page.evaluate(() => document.getElementById('app').__vue_app__
        .config.globalProperties.$pinia._s.get('message').directUnreadCount), 0);
    }
    console.log('Control passed: ' + platform + ' ' + username);
    await h.context.close();
  }
  console.log('Screenshots: ' + output);
} finally {
  await browser.close();
}
