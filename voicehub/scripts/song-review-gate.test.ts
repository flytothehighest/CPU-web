import assert from 'node:assert/strict'
import test from 'node:test'
import { songReviewFingerprint } from '../server/utils/song-review-policy'

// Lazy postgres connection never reaches a database: the gate runs against an injected transaction.
process.env.DATABASE_URL = 'postgres://test:test@127.0.0.1:1/unused'
process.env.REDIS_ENABLED = 'false'
delete process.env.REDIS_URL
const { requireSchedulableSongs } = await import('../server/services/songReviewService')

const song = { id: 1, title: '测试歌曲', artist: '测试歌手', musicPlatform: 'netease', musicId: '123', playUrl: '' }
const config = { enabled: true, policyVersion: 'rules-v1' }
const approval = { songId: 1, status: 'approved', fingerprint: songReviewFingerprint(song), policyVersion: 'rules-v1' }
function transaction(songRows: any[], reviewRows: any[]) {
  let reads = 0
  const locks: string[] = []
  return { locks, get reads() { return reads }, select() {
    const rows = reads++ === 0 ? songRows : reviewRows
    const query = { from: () => query, where: () => query, orderBy: () => query, for: (mode: string) => { locks.push(mode); return Promise.resolve(rows) }, then: (resolve: any, reject: any) => Promise.resolve(rows).then(resolve, reject) }
    return query
  } }
}

test('排期门禁锁住歌曲行，检查审核后才允许调用方写排期', async () => {
  const tx = transaction([song], [approval])
  await requireSchedulableSongs(tx as any, [1, 1], config)
  assert.deepEqual(tx.locks, ['update'])
  assert.equal(tx.reads, 2)
})

test('新歌、未通过、过期审核、错绑音源和批量夹带未审歌均返回409', async () => {
  for (const reviews of [[], [{ ...approval, status: 'uncertain' }], [{ ...approval, status: 'error' }], [{ ...approval, policyVersion: 'old' }], [{ ...approval, fingerprint: 'other' }]]) {
    await assert.rejects(requireSchedulableSongs(transaction([song], reviews) as any, [1], config), { statusCode: 409 })
  }
  await assert.rejects(requireSchedulableSongs(transaction([song, { ...song, id: 2 }], [approval]) as any, [1, 2], config), { statusCode: 409 })
  await assert.rejects(requireSchedulableSongs(transaction([], []) as any, [999], config), { statusCode: 409 })
})

test('无效ID不能绕过，关闭审核或空批次不查审核记录', async () => {
  await assert.rejects(requireSchedulableSongs(transaction([], []) as any, ['1 OR 1=1'], config), { statusCode: 400 })
  for (const [ids, enabled] of [[[1], false], [[], true]] as const) {
    const tx = transaction([], [])
    await requireSchedulableSongs(tx as any, [...ids], { ...config, enabled })
    assert.equal(tx.reads, 0)
  }
})

test('普通用户不能读取审核详情，也不能触发AI或伪造人工批准', async () => {
  const { default: list } = await import('../server/api/admin/songs/reviews.get')
  const { default: review } = await import('../server/api/admin/songs/review.post')
  for (const user of [undefined, { id: 1, role: 'USER' }]) {
    await assert.rejects(list({ context: { user } } as any), { statusCode: 403 })
    await assert.rejects(review({ context: { user } } as any), { statusCode: 403 })
  }
})

test('投稿人确认采用当前建议版本，锁内检查身份、期限和音源', async t => {
  const { db } = await import('../app/drizzle/db')
  const { actOnSongAdvice } = await import('../server/services/songAdviceLifecycle')
  const token = '12345678-1234-4123-8123-123456789abc'
  const owned = { ...song, requesterId: 7, played: false, hitRequestId: null }
  const current = { ...approval, status: 'rejected', attemptId: token, confirmedAt: null, notifiedAt: new Date(), fingerprint: songReviewFingerprint(owned) }
  let stored = current
  let writes: any[] = []
  const original = db.transaction
  ;(db as any).transaction = async (fn: any) => {
    let reads = 0
    return fn({ select: () => {
      const rows = reads++ === 0 ? [owned] : [stored]
      return { from: () => ({ where: () => ({ for: async () => rows }) }) }
    }, update: () => ({ set: (value: any) => ({ where: async () => { writes.push(value) } }) }) })
  }
  t.after(() => { (db as any).transaction = original })
  const input = { songId: 1, reviewToken: token, action: 'confirm' as const, acknowledged: true as const }
  await assert.rejects(actOnSongAdvice(input, 8, config), { statusCode: 403 })
  await assert.rejects(actOnSongAdvice({ ...input, reviewToken: 'stale' }, 7, config), { statusCode: 409 })
  stored = { ...current, notifiedAt: new Date(Date.now() - 86_400_001) }
  await assert.rejects(actOnSongAdvice(input, 7, config), { statusCode: 409 })
  assert.equal(writes.length, 0)
  stored = current
  const result = await actOnSongAdvice(input, 7, config)
  assert.equal(result.withdrawn, false)
  assert.ok(writes[0].confirmedAt instanceof Date)
})

test('用户按建议撤回时在事务中清理关联记录，已排期投稿不会被误撤回', async t => {
  const { db } = await import('../app/drizzle/db')
  const { actOnSongAdvice } = await import('../server/services/songAdviceLifecycle')
  const token = '12345678-1234-4123-8123-123456789abc'
  const owned = { ...song, requesterId: 7, played: false, hitRequestId: 9 }
  const current = { ...approval, status: 'uncertain', attemptId: token, confirmedAt: null, notifiedAt: new Date(), fingerprint: songReviewFingerprint(owned) }
  let scheduled = false
  let deletes = 0
  let updates = 0
  const original = db.transaction
  ;(db as any).transaction = async (fn: any) => {
    const batches = [[owned], [current], scheduled ? [{ id: 10 }] : [], []]
    return fn({
      select: () => { const rows = batches.shift(); const q: any = { from: () => q, where: () => q, for: async () => rows, limit: async () => rows, then: (resolve: any) => Promise.resolve(rows).then(resolve) }; return q },
      execute: async () => [],
      update: () => ({ set: () => ({ where: async () => { updates++ } }) }),
      delete: () => ({ where: async () => { deletes++ } })
    })
  }
  t.after(() => { (db as any).transaction = original })
  const input = { songId: 1, reviewToken: token, action: 'withdraw' as const, acknowledged: true as const }
  scheduled = true
  await assert.rejects(actOnSongAdvice(input, 7, config), { statusCode: 409 })
  assert.equal(deletes, 0)
  scheduled = false
  assert.equal((await actOnSongAdvice(input, 7, config)).withdrawn, true)
  assert.equal(deletes, 1)
  assert.equal(updates, 1)
})

test('后台24小时撤回再次读取锁内确认状态，用户刚确认时不会删除', async t => {
  const { db } = await import('../app/drizzle/db')
  const { deliverSongAdviceAndExpire } = await import('../server/services/songAdviceLifecycle')
  const owned = { ...song, requesterId: 7, played: false, hitRequestId: null }
  const expired = { ...approval, status: 'rejected', notificationKey: null, notifiedAt: new Date(Date.now() - 86_400_001), confirmedAt: null, fingerprint: songReviewFingerprint(owned), updatedAt: new Date() }
  const originalSelect = db.select
  const originalTransaction = db.transaction
  let confirmedDuringLock = true
  let deletes = 0
  ;(db as any).select = () => {
    const q: any = { from: () => q, innerJoin: () => q, where: async () => [{ song: owned, review: expired }] }
    return q
  }
  ;(db as any).transaction = async (fn: any) => {
    const batches = [[owned], [{ ...expired, confirmedAt: confirmedDuringLock ? new Date() : null }], [], []]
    return fn({
      select: () => { const rows = batches.shift(); const q: any = { from: () => q, where: () => q, for: async () => rows, limit: async () => rows, then: (resolve: any) => Promise.resolve(rows).then(resolve) }; return q },
      execute: async () => [], delete: () => ({ where: async () => { deletes++ } })
    })
  }
  t.after(() => { (db as any).select = originalSelect; (db as any).transaction = originalTransaction })
  await deliverSongAdviceAndExpire(config)
  assert.equal(deletes, 0)
  confirmedDuringLock = false
  await deliverSongAdviceAndExpire(config)
  assert.equal(deletes, 1)
})
