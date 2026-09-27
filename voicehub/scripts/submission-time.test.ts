import assert from 'node:assert/strict'
import test from 'node:test'
import { drizzle } from 'drizzle-orm/postgres-js'
import { songs, songReviews } from '../app/drizzle/schema'
import { formatDateTime } from '../app/utils/timeUtils'

test('existing Beijing submission timestamp is not shifted into the next day', () => {
  const date = songs.createdAt.mapFromDriverValue('2026-09-27 23:09:09.878541')
  assert.equal(date.toISOString(), '2026-09-27T15:09:09.878Z')
  assert.equal(formatDateTime(date), '2026/9/27 23:09:09')
})

test('explicit import dates and query bounds round-trip as Beijing wall time', () => {
  const instant = new Date('2026-09-27T17:43:00.123Z')
  const stored = songs.createdAt.mapToDriverValue(instant)
  assert.equal(stored, '2026-09-28 01:43:00.123')
  assert.equal(songs.createdAt.mapFromDriverValue(stored).getTime(), instant.getTime())
})

test('new submissions send an explicit Beijing time regardless of DB session timezone', () => {
  const before = Date.now()
  const query = drizzle.mock().insert(songs).values({ title: 'fixture', artist: 'fixture', requesterId: 1 }).toSQL()
  const date = songs.createdAt.mapFromDriverValue(query.params[0] as string)
  assert.ok(date.getTime() >= before && date.getTime() <= Date.now())
})

test('timezone-aware advice deadlines retain their original instant', () => {
  assert.equal(songReviews.notifiedAt.mapFromDriverValue('2026-09-27 23:09:09+08').toISOString(), '2026-09-27T15:09:09.000Z')
})
