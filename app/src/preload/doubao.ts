/**
 * 豆包 Webview 专用 Preload 脚本
 * 在豆包页面的任何脚本执行之前运行，用于清除 Electron 自动化指纹
 * 这是解决反爬虫检测的关键 — 必须在 webmssdk.es5.js 之前执行
 */

(function () {
  'use strict'

  try {
    // 1. 移除 webdriver 标记
    Object.defineProperty(navigator, 'webdriver', {
      get: function () { return false },
      configurable: true,
    })

    // 2. 伪造 window.chrome (Electron 没有)
    if (typeof window.chrome === 'undefined') {
      Object.defineProperty(window, 'chrome', {
        value: { runtime: {}, loadTimes: function () {} },
        enumerable: true,
        configurable: true,
      })
    }

    // 3. 伪造 navigator.plugins
    if (!navigator.plugins || navigator.plugins.length === 0) {
      Object.defineProperty(navigator, 'plugins', {
        get: function () {
          return [
            { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', type: 'application/pdf' },
            { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', type: '' },
            { name: 'Native Client', filename: 'internal-nacl-plugin', type: '' },
          ]
        },
        configurable: true,
      })
    }

    // 4. 伪造 navigator.languages
    Object.defineProperty(navigator, 'languages', {
      get: function () { return ['zh-CN', 'zh', 'en', 'en-US'] },
      configurable: true,
    })

    // 5. 伪造 navigator.platform
    Object.defineProperty(navigator, 'platform', {
      get: function () { return 'Win32' },
      configurable: true,
    })

    // 6. 伪造 permissions.query
    const originalQuery = window.navigator.permissions.query.bind(window.navigator.permissions)
    window.navigator.permissions.query = function (parameters) {
      if (parameters && parameters.name === 'notifications') {
        return Promise.resolve({ state: Notification.permission })
      }
      return originalQuery(parameters)
    }

    // 7. 删除 Electron 特征对象
    delete window.require
    delete window.module

    // 8. 伪造 userAgent (如果还没被设置)
    // 这通过 onBeforeSendHeaders 处理，但这里再加一层保险
    const fakeUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    if (!navigator.userAgent.includes('Chrome/131')) {
      Object.defineProperty(navigator, 'userAgent', {
        get: function () { return fakeUA },
        configurable: true,
      })
    }

    // 9. 伪造 cookieEnabled
    try {
      if (!navigator.cookieEnabled) {
        Object.defineProperty(navigator, 'cookieEnabled', {
          get: function () { return true },
          configurable: true,
        })
      }
    } catch (e) { /* ignore */ }

    // 10. 阻止检测 isElectron
    Object.defineProperty(window, 'isElectron', {
      get: function () { return undefined },
      configurable: true,
    })

    // eslint-disable-next-line no-console
    console.log('[DoubaoPreload] 反检测脚本已注入')
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[DoubaoPreload] 反检测脚本部分失败:', e)
  }
})()