package com.logia.app

import android.os.Bundle
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

/**
 * Edge-to-edge, so the WebView draws behind the status and gesture bars. Older system
 * WebViews report 0 for `env(safe-area-inset-*)` and don't shrink for the keyboard, so:
 * - the content view is padded by the keyboard's height, which resizes the WebView
 *   (the page then sees a normal `resize`), and
 * - the bar sizes go to the page as `--android-safe-*` CSS variables, readable at
 *   startup through `window.LogiaInsets.get()` and pushed again on every change.
 */
class MainActivity : TauriActivity() {
  private var webView: WebView? = null
  @Volatile private var insetsJson = "{\"top\":0,\"bottom\":0,\"left\":0,\"right\":0}"

  inner class InsetsBridge {
    @JavascriptInterface
    fun get(): String = insetsJson
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      val keyboardOpen = ime.bottom > bars.bottom
      view.setPadding(0, 0, 0, if (keyboardOpen) ime.bottom else 0)

      val density = resources.displayMetrics.density
      fun css(px: Int) = Math.round(px / density)
      // With the keyboard up the padding already clears the gesture bar.
      val bottom = if (keyboardOpen) 0 else css(bars.bottom)
      insetsJson = "{\"top\":${css(bars.top)},\"bottom\":$bottom,\"left\":${css(bars.left)},\"right\":${css(bars.right)}}"
      pushInsets()
      insets
    }
  }

  override fun onWebViewCreate(webView: WebView) {
    this.webView = webView
    webView.addJavascriptInterface(InsetsBridge(), "LogiaInsets")
    pushInsets()
  }

  private fun pushInsets() {
    val wv = webView ?: return
    val json = insetsJson
    wv.post {
      wv.evaluateJavascript(
        "window.dispatchEvent(new CustomEvent('logia-insets',{detail:$json}))",
        null,
      )
    }
  }
}
