import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import express from 'express';

test('歌曲建议通知验证集成密钥、去重重试并链接投稿确认入口', async t => {
  process.env.REDIS_ENABLED = 'false';
  const { prisma } = await import('../src/prisma');
  const { config } = await import('../src/config');
  const { integrationsRouter } = await import('../src/routes/integrations');
  const replace = (target: any, key: string, value: any) => { const before = target[key]; target[key] = value; t.after(() => { target[key] = before; }); };
  const secret = 'test-song-advice-secret-32-characters-long';
  replace(config, 'voiceHubIntegrationSecret', secret);
  const messages: any[] = [];
  let locks = 0;
  replace(prisma.user, 'findMany', async () => [{ id: 7 }]);
  replace(prisma, '$transaction', async (fn: any) => fn(prisma));
  replace(prisma, '$executeRaw', async () => { locks++; return 1; });
  replace(prisma.notification, 'findFirst', async ({ where }: any) => messages.find(m => m.userId === where.userId && m.payload.includes(where.payload.contains)) || null);
  replace(prisma.notification, 'create', async ({ data }: any) => { messages.push(data); return { id: messages.length, ...data }; });
  const app = express();
  app.use(express.json(), integrationsRouter);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err.status || 400).json({ error: err.message }));
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())));
  const port = (server.address() as any).port;
  const body = { notifications: [{ userId: 7, title: '歌曲投稿需要再次确认', content: '大概率不会被接受，24小时未确认自动撤回', type: 'SONG_REVIEW_ADVICE', songId: 123, deliveryKey: 'a'.repeat(64) }] };
  const send = (key: string) => fetch(`http://127.0.0.1:${port}/voicehub/notifications`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-voicehub-integration-secret': key }, body: JSON.stringify(body) });
  assert.equal((await send('wrong')).status, 401);
  assert.equal(messages.length, 0);
  for (let i = 0; i < 2; i++) {
    const response = await send(secret);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.count, 1);
  }
  assert.equal(locks, 2);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].link, '/voicehub/?reviewSong=123');
  assert.equal(messages[0].category, 'service-tool');
});
