import { getSongReviewConfig, reviewNextPendingSong } from '../services/songReviewService'
import { deliverSongAdviceAndExpire } from '../services/songAdviceLifecycle'

export default defineNitroPlugin(nitro => {
  // Sequential bounded work; pending rows survive restart. Expired checking leases can be reclaimed.
  let running = false
  let stopped = false
  const timer = setInterval(async () => {
    if (running || stopped) return
    running = true
    try {
      await deliverSongAdviceAndExpire(await getSongReviewConfig())
      await reviewNextPendingSong()
      await deliverSongAdviceAndExpire(await getSongReviewConfig())
    }
    catch (error: any) { console.warn('[song-review] background review deferred:', error?.statusCode || 'unavailable') }
    finally { running = false }
  }, 30_000)
  timer.unref?.()
  nitro.hooks.hook('close', () => { stopped = true; clearInterval(timer) })
})
