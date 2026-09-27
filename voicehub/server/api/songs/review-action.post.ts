import { createError, defineEventHandler, readBody } from 'h3'
import { z } from 'zod'
import { actOnSongAdvice } from '../../services/songAdviceLifecycle'
import { getSongReviewConfig } from '../../services/songReviewService'

const schema = z.object({ songId: z.number().int().positive(), reviewToken: z.string().uuid(), action: z.enum(['confirm', 'withdraw']), acknowledged: z.literal(true) }).strict()
export default defineEventHandler(async event => {
  const user = event.context.user
  if (!user) throw createError({ statusCode: 401, message: '请先登录' })
  const input = schema.safeParse(await readBody(event))
  if (!input.success) throw createError({ statusCode: 400, message: '请先阅读当前选曲建议，再确认或撤回投稿' })
  return actOnSongAdvice(input.data, user.id, await getSongReviewConfig())
})
