package cn.lizmt.cpuweb.schedule

import android.content.Context
import android.view.MotionEvent
import android.widget.FrameLayout
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [26, 35])
class ShellWebViewTest {
    private class GestureHost(context: Context) : FrameLayout(context) {
        var interceptionDisallowed = false
        override fun requestDisallowInterceptTouchEvent(disallow: Boolean) {
            interceptionDisallowed = disallow
            super.requestDisallowInterceptTouchEvent(disallow)
        }
    }

    @Test fun pageRetainsGestureUntilUpOrCancelIncludingAfterReattachment() {
        val context = RuntimeEnvironment.getApplication()
        val page = ShellWebView(context)
        val first = GestureHost(context)
        val second = GestureHost(context)
        for (host in listOf(first, second)) {
            host.addView(page)
            for (ending in listOf(MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL)) {
                fun send(action: Int) {
                    val event = MotionEvent.obtain(0, 20, action, 100f, 300f, 0)
                    page.dispatchTouchEvent(event)
                    event.recycle()
                }
                send(MotionEvent.ACTION_DOWN)
                assertTrue("Claim before the host can intercept MOVE", host.interceptionDisallowed)
                send(MotionEvent.ACTION_MOVE)
                assertTrue(host.interceptionDisallowed)
                send(ending)
                assertFalse("Native gestures must work after the page gesture ends", host.interceptionDisallowed)
            }
            host.removeView(page)
        }
        val event = MotionEvent.obtain(0, 20, MotionEvent.ACTION_CANCEL, 0f, 0f, 0)
        page.dispatchTouchEvent(event) // Renderer replacement can detach the view mid-gesture.
        event.recycle()
        page.destroy()
    }
}
