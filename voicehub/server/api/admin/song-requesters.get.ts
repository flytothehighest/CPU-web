import { createError, defineEventHandler, getQuery, setHeader } from 'h3'
import { asc, ilike, or } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { users } from '~/drizzle/schema'

// The account-management API is retired; song editors only need local shadow-user IDs.
export default defineEventHandler(async event => {
  if (!event.context.user || !['SONG_ADMIN', 'ADMIN', 'SUPER_ADMIN'].includes(event.context.user.role)) {
    throw createError({ statusCode: 403, message: '没有歌曲管理权限' })
  }
  setHeader(event, 'Cache-Control', 'private, no-store')
  const query = getQuery(event)
  const search = typeof query.search === 'string' ? query.search.trim().slice(0, 80) : ''
  if (search.length < 2) return { users: [] }
  const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`
  const matches = await db.select({ id: users.id, name: users.name, username: users.username }).from(users)
    .where(or(ilike(users.name, pattern), ilike(users.username, pattern))).orderBy(asc(users.id)).limit(20)
  return { users: matches }
})
