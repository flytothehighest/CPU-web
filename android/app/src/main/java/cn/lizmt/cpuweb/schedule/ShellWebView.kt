package cn.lizmt.cpuweb.schedule

import android.content.Context
import android.view.MotionEvent
import android.webkit.WebView

/** Keep a gesture that starts on the page in the WebView, including nested DOM scrollers. */
class ShellWebView(context: Context) : WebView(context) {
    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        // Claim the sequence before MOVE crosses the parent's drag threshold.
        // The Compose AndroidView host must not cancel it in favour of a native drag.
        if (event.actionMasked == MotionEvent.ACTION_DOWN) {
            parent?.requestDisallowInterceptTouchEvent(true)
        }
        return try {
            super.dispatchTouchEvent(event)
        } finally {
            if (event.actionMasked == MotionEvent.ACTION_UP || event.actionMasked == MotionEvent.ACTION_CANCEL) {
                parent?.requestDisallowInterceptTouchEvent(false)
            }
        }
    }
}
