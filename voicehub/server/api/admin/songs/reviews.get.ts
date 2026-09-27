import { createError, defineEventHandler } from 'h3'
import { listSongReviews } from '../../../services/songReviewService'

export default defineEventHandler(async event => {
  if (!event.context.user || !['SONG_ADMIN', 'ADMIN', 'SUPER_ADMIN'].includes(event.context.user.role)) {
    throw createError({ statusCode: 403, message: '没有歌曲审核权限' })
  }
  return listSongReviews()
})
