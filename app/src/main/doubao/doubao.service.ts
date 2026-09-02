import { BrowserWindow, session, app, type WebContents, type Session } from 'electron'
import { join } from 'node:path'
import { Injectable, Logger } from '@electrum/common'
import type { OnModuleInit, OnModuleDestroy } from '@electrum/common'

/** 一条对话消息 */
export interface DoubaoMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
}

/** 连接状态 */
export type DoubaoStatus = 'idle' | 'connecting' | 'ready' | 'generating' | 'error'

/** 诊断信息 */
export interface DoubaoDiagnostic {
  url: string
  title: string
  bodyText: string
  hasInput: boolean
  hasTextarea: boolean
  hasContentEditable: boolean
  pageHint: string
}

@Injectable()
export class DoubaoService implements OnModuleInit, OnModuleDestroy {
  private logger = new Logger('DoubaoService')
  private guestWebContents: WebContents | null = null
  private mainWin: BrowserWindow | null = null
  private status: DoubaoStatus = 'idle'
  private lastMessages: DoubaoMessage[] = []
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private cleanupCspFilter: (() => void) | null = null
  private cleanupSendHeaders: (() => void) | null = null
  private cleanupWebviewListener: (() => void) | null = null
  private doubaoSession: Session | null = null

  private readonly DOUBAO_URL = 'https://www.doubao.com/chat/'
  private readonly POLL_INTERVAL = 1500
  private readonly MAX_POLL_WAIT = 120_000
  private readonly CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  private readonly PARTITION = 'persist:doubao'

  // DOM 选择器策略
  private readonly inputSelectors = [
    'textarea[data-testid="reply-box"]',
    'textarea[placeholder*="发消息"]',
    'textarea[placeholder*="输入"]',
    'textarea[class*="input"]',
    'div[contenteditable="true"][data-testid="reply-box"]',
    'div[contenteditable="true"][class*="input"]',
    '.composer input',
    '.chat-input textarea',
  ]

  private readonly sendSelectors = [
    'button[data-testid="send"]',
    'button[aria-label*="发送"]',
    'button[aria-label*="send"]',
    'button.send-btn',
    'button[class*="send"]',
    'button[class*="Submit"]',
  ]

  private readonly messageItemSelectors = [
    '.message-list .message-item',
    '[data-role="message"]',
    '.chat-message',
    '.message-item',
    '[class*="message-item"]',
    '[class*="MessageItem"]',
    'div[class*="message"]',
  ]

  private readonly userMessageSelectors = [
    '.message-item.user .message-content',
    '[data-role="message"][data-author="user"]',
    '.chat-message.user',
    '[class*="user-message"]',
    '.user-message',
  ]

  private readonly assistantMessageSelectors = [
    '.message-item.assistant .message-content',
    '.message-item.bot .message-content',
    '[data-role="message"][data-author="assistant"]',
    '.chat-message.assistant',
    '.assistant-message',
    '[class*="assistant-message"]',
    '[class*="bot-message"]',
  ]

  private readonly generatingSelectors = [
    '[class*="typing"]',
    '[class*="generating"]',
    '[class*="loading"]',
    '[aria-label*="正在输入"]',
    '[aria-label*="生成中"]',
    '.cursor',
    '.blink',
  ]

  onModuleInit() {
    this.logger.log('DoubaoService ready (webview mode)')
  }

  onModuleDestroy() {
    this.stopPolling()
    this.disconnect()
  }

  /** 连接 — 设置 webview 所需的 session 和监听，由渲染器创建 <webview> 标签 */
  async connect(): Promise<{ status: DoubaoStatus }> {
    if (this.guestWebContents && !this.guestWebContents.isDestroyed()) {
      return { status: this.status }
    }

    this.setStatus('connecting')

    // 获取主窗口
    this.mainWin = this.findMainWindow()
    if (!this.mainWin) {
      this.logger.error('找不到主窗口')
      this.setStatus('error')
      return { status: this.status }
    }

    // 使用独立 partition 的 session（持久化登录态）
    this.doubaoSession = session.fromPartition(this.PARTITION)

    // 1. 移除 CSP 响应头
    this.cleanupCspFilter = this.doubaoSession.webRequest.onHeadersReceived((details, callback) => {
      if (details.url.includes('doubao.com')) {
        const headers = { ...details.responseHeaders }
        delete headers['content-security-policy']
        delete headers['content-security-policy-report-only']
        callback({ responseHeaders: headers })
      } else {
        callback({ responseHeaders: details.responseHeaders })
      }
    })

    // 2. 伪装 User-Agent
    this.cleanupSendHeaders = this.doubaoSession.webRequest.onBeforeSendHeaders((details, callback) => {
      if (details.url.includes('doubao.com')) {
        details.requestHeaders['User-Agent'] = this.CHROME_UA
      }
      callback({ requestHeaders: details.requestHeaders })
    })

    // 3. 监听 webview 挂载事件，获取 guestWebContents
    const wc = this.mainWin.webContents
    const onAttachWebview = async (event: any, guestContents: WebContents) => {
      this.logger.log('Webview 已挂载，获取 guestWebContents')
      this.guestWebContents = guestContents

      // 页面加载完成后诊断
      guestContents.on('did-finish-load', async () => {
        this.logger.log(`webview 页面已加载: ${guestContents.getURL()}`)

        // 输出诊断信息
        try {
          const diag = await this.diagnose()
          this.logger.log(`页面诊断: ${diag.pageHint}`)
          this.logger.log(`  URL: ${diag.url}`)
          this.logger.log(`  Title: ${diag.title}`)
          this.logger.log(`  hasTextarea: ${diag.hasTextarea}, hasContentEditable: ${diag.hasContentEditable}`)
        } catch { /* ignore */ }

        this.setStatus('ready')
      })

      guestContents.on('did-fail-load', (_evt, errorCode, errorDescription) => {
        this.logger.error(`webview 加载失败: ${errorCode} ${errorDescription}`)
        this.setStatus('error')
      })

      // 注入反检测脚本（双重保险，preload 脚本已先执行一次）
      try {
        await guestContents.executeJavaScript(this.buildAntiDetectionScript())
      } catch { /* ignore */ }
    }

    wc.on('did-attach-webview', onAttachWebview)
    this.cleanupWebviewListener = () => {
      wc.removeListener('did-attach-webview', onAttachWebview)
    }

    this.logger.log('Webview 监听已就绪，等待渲染器创建 <webview> 标签...')

    return { status: this.status }
  }

  /** 断开连接 — 清理所有监听器 */
  disconnect(): void {
    this.cleanupCspFilter?.()
    this.cleanupCspFilter = null
    this.cleanupSendHeaders?.()
    this.cleanupSendHeaders = null
    this.cleanupWebviewListener?.()
    this.cleanupWebviewListener = null
    this.guestWebContents = null
    this.doubaoSession = null
    this.mainWin = null
    this.stopPolling()
    this.setStatus('idle')
    this.logger.log('豆包已断开')
  }

  /** 页面诊断 */
  async diagnose(): Promise<DoubaoDiagnostic> {
    if (!this.guestWebContents || this.guestWebContents.isDestroyed()) {
      return {
        url: '', title: '', bodyText: '',
        hasInput: false, hasTextarea: false, hasContentEditable: false,
        pageHint: 'webview 未连接',
      }
    }

    try {
      const result = await this.guestWebContents.executeJavaScript(`
        (function() {
          const inputs = document.querySelectorAll('input');
          const textareas = document.querySelectorAll('textarea');
          const contentEditables = document.querySelectorAll('[contenteditable="true"]');
          const title = document.title || '';
          const url = location.href;
          const bodyText = document.body ? document.body.innerText.slice(0, 500) : '';
          let pageHint = 'unknown';
          if (url.includes('login') || url.includes('passport')) pageHint = '需要登录';
          else if (url.includes('region-ban')) pageHint = '触发区域限制/反爬虫';
          else if (bodyText.includes('验证码') || bodyText.includes('CAPTCHA')) pageHint = '需要验证码';
          else if (textareas.length > 0 || contentEditables.length > 0) pageHint = '聊天界面已加载';
          else if (bodyText.includes('豆包')) pageHint = '已加载但未找到输入框';
          return { url, title, bodyText, hasInput: inputs.length > 0, hasTextarea: textareas.length > 0, hasContentEditable: contentEditables.length > 0, pageHint };
        })();
      `) as DoubaoDiagnostic
      return result
    } catch {
      return {
        url: this.guestWebContents.getURL(), title: '', bodyText: '',
        hasInput: false, hasTextarea: false, hasContentEditable: false,
        pageHint: '诊断脚本执行失败',
      }
    }
  }

  /** 获取当前状态 */
  getStatus(): { status: DoubaoStatus; hasWebview: boolean } {
    return {
      status: this.status,
      hasWebview: !!(this.guestWebContents && !this.guestWebContents.isDestroyed()),
    }
  }

  /** 获取 webview preload 路径 — 供渲染器 <webview preload="..."> 使用 */
  getPreloadPath(): string {
    const appPath = app.getAppPath()
    return join(appPath, 'out', 'preload', 'doubao.js')
  }

  /** 发送 prompt 到豆包 */
  async sendPrompt(text: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.guestWebContents || this.guestWebContents.isDestroyed()) {
      return { ok: false, error: '豆包 webview 未连接' }
    }

    try {
      const inputFilled = await this.findAndFillInput(this.guestWebContents, text)
      if (!inputFilled) {
        return { ok: false, error: '未找到输入框，可能页面结构变化或未登录' }
      }

      const sent = await this.triggerSend(this.guestWebContents)
      if (!sent) {
        return { ok: false, error: '未找到发送按钮' }
      }

      this.setStatus('generating')
      this.logger.log(`已发送 prompt: ${text.slice(0, 50)}...`)
      return { ok: true }
    } catch (err) {
      this.logger.error(`sendPrompt error: ${String(err)}`)
      return { ok: false, error: String(err) }
    }
  }

  /** 提取所有对话消息 */
  async extractMessages(): Promise<DoubaoMessage[]> {
    if (!this.guestWebContents || this.guestWebContents.isDestroyed()) {
      return this.lastMessages
    }

    try {
      const messages = await this.guestWebContents.executeJavaScript(this.buildExtractScript()) as DoubaoMessage[]
      if (Array.isArray(messages) && messages.length > 0) {
        this.lastMessages = messages
      }
      return this.lastMessages
    } catch (err) {
      this.logger.error(`extractMessages error: ${String(err)}`)
      return this.lastMessages
    }
  }

  /** 提取消息并转为 XML */
  async extractXml(): Promise<string> {
    const messages = await this.extractMessages()
    return this.toXml(messages)
  }

  /** 消息转 XML */
  toXml(messages: DoubaoMessage[]): string {
    const msgs = messages.map(m => {
      const escaped = m.content
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')
      return `  <message role="${m.role}" timestamp="${m.timestamp}">${escaped}</message>`
    })
    return `<?xml version="1.0" encoding="UTF-8"?>\n<conversation>\n${msgs.join('\n')}\n</conversation>`
  }

  /** 等待响应完成 */
  async waitForCompletion(): Promise<{ messages: DoubaoMessage[]; xml: string }> {
    if (!this.guestWebContents || this.guestWebContents.isDestroyed()) {
      return { messages: [], xml: this.toXml([]) }
    }

    this.setStatus('generating')
    const startTime = Date.now()
    let lastContent = ''
    let stableCount = 0

    return new Promise((resolve) => {
      this.pollTimer = setInterval(async () => {
        try {
          const wc = this.guestWebContents
          if (!wc || wc.isDestroyed()) {
            this.stopPolling()
            resolve({ messages: this.lastMessages, xml: this.toXml(this.lastMessages) })
            return
          }

          const generating = await wc.executeJavaScript(this.buildGeneratingCheckScript()) as boolean
          const messages = await this.extractMessages()
          const currentContent = messages.map(m => m.content).join('')

          if (!generating && messages.length > 0 && currentContent === lastContent) {
            stableCount++
          } else {
            stableCount = 0
          }
          lastContent = currentContent

          if (stableCount >= 2) {
            this.stopPolling()
            this.setStatus('ready')
            this.logger.log('响应完成')
            resolve({ messages: this.lastMessages, xml: this.toXml(this.lastMessages) })
          }

          if (Date.now() - startTime > this.MAX_POLL_WAIT) {
            this.stopPolling()
            this.setStatus('ready')
            this.logger.log('等待超时，返回当前结果')
            resolve({ messages: this.lastMessages, xml: this.toXml(this.lastMessages) })
          }
        } catch {
          // ignore
        }
      }, this.POLL_INTERVAL)
    })
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  private setStatus(status: DoubaoStatus): void {
    this.status = status
  }

  /** 查找主窗口 */
  private findMainWindow(): BrowserWindow | null {
    // 尝试从聚焦窗口获取
    const focused = BrowserWindow.getFocusedWindow()
    if (focused && !focused.isDestroyed()) return focused

    // 遍历所有窗口找第一个
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) return win
    }
    return null
  }

  /** 查找输入框并填入文字 */
  private async findAndFillInput(wc: WebContents, text: string): Promise<boolean> {
    for (const selector of this.inputSelectors) {
      try {
        const result = await wc.executeJavaScript(`
          (function() {
            const el = document.querySelector('${selector}');
            if (!el) return { found: false };
            if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
              el.focus();
              el.value = ${JSON.stringify(text)};
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return { found: true, type: 'native' };
            }
            if (el.getAttribute('contenteditable') === 'true') {
              el.focus();
              el.textContent = ${JSON.stringify(text)};
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return { found: true, type: 'contenteditable' };
            }
            return { found: false };
          })();
        `) as { found: boolean }
        if (result?.found) {
          this.logger.log(`输入框定位成功: ${selector}`)
          return true
        }
      } catch { /* continue */ }
    }
    return false
  }

  /** 触发发送 */
  private async triggerSend(wc: WebContents): Promise<boolean> {
    for (const selector of this.sendSelectors) {
      try {
        const result = await wc.executeJavaScript(`
          (function() {
            const btn = document.querySelector('${selector}');
            if (!btn) return { found: false };
            btn.click();
            return { found: true };
          })();
        `) as { found: boolean }
        if (result?.found) {
          this.logger.log(`发送按钮点击成功: ${selector}`)
          return true
        }
      } catch { /* continue */ }
    }

    // 兜底：Enter 键
    try {
      const result = await wc.executeJavaScript(`
        (function() {
          const input = document.querySelector('textarea, [contenteditable="true"]');
          if (!input) return { found: false };
          input.focus();
          const enterEvent = new KeyboardEvent('keydown', {
            key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true,
          });
          input.dispatchEvent(enterEvent);
          return { found: true, fallback: 'enter' };
        })();
      `) as { found: boolean }
      if (result?.found) {
        this.logger.log('Enter 键兜底提交成功')
        return true
      }
    } catch { /* ignore */ }

    return false
  }

  /** 构建消息提取脚本 */
  private buildExtractScript(): string {
    const msgSelectors = this.messageItemSelectors.map(s => `'${s}'`).join(', ')
    const userSelectors = this.userMessageSelectors.map(s => `'${s}'`).join(', ')
    const botSelectors = this.assistantMessageSelectors.map(s => `'${s}'`).join(', ')

    return `
      (function() {
        function queryAllFirst(selectors, root) {
          for (const sel of selectors) {
            const els = (root || document).querySelectorAll(sel);
            if (els.length > 0) return Array.from(els);
          }
          return [];
        }
        let items = queryAllFirst([${msgSelectors}]);
        if (items.length === 0) {
          const userMsgs = queryAllFirst([${userSelectors}]);
          const botMsgs = queryAllFirst([${botSelectors}]);
          items = [...userMsgs, ...botMsgs];
        }
        if (items.length === 0) {
          items = Array.from(document.querySelectorAll('div[class*="message"], div[class*="Message"]')).filter(el => el.offsetWidth > 0);
        }
        const messages = items.map((el) => {
          const isUser = !!(el.closest('[class*="user"]') || el.classList.contains('user') || el.className.includes('user'));
          const role = isUser ? 'user' : 'assistant';
          let content = '';
          const contentEl = el.querySelector('.message-content, [class*="content"], p, span');
          content = contentEl ? (contentEl.innerText || contentEl.textContent || '') : (el.innerText || el.textContent || '');
          content = content.trim();
          if (!content) return null;
          return { role, content, timestamp: Date.now() };
        }).filter(Boolean);
        const seen = new Set();
        return messages.filter(m => {
          const key = m.role + ':' + m.content.slice(0, 100);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      })();
    `
  }

  /** 反检测脚本（preload 已注入，这里作为双重保险） */
  private buildAntiDetectionScript(): string {
    return `
      (function() {
        try {
          Object.defineProperty(navigator, 'webdriver', { get: () => false });
          if (!window.chrome) {
            Object.defineProperty(window, 'chrome', { value: { runtime: {} }, configurable: true });
          }
          Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5] });
          Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN','zh','en'] });
          delete window.require;
          delete window.module;
        } catch(e) { console.warn('Doubao anti-detection failed:', e); }
      })();
    `
  }

  /** 生成状态检测脚本 */
  private buildGeneratingCheckScript(): string {
    const genSelectors = this.generatingSelectors.map(s => `'${s}'`).join(', ')
    return `
      (function() {
        const selectors = [${genSelectors}];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el && el.offsetWidth > 0) return true;
        }
        const indicators = ['正在输入', '思考中', '生成中', '正在生成', 'typing', 'generating'];
        const allText = document.body.innerText;
        for (const ind of indicators) {
          if (allText.includes(ind)) {
            const lastMsg = document.querySelector('[class*="message"]:last-child, [class*="Message"]:last-child');
            if (lastMsg && lastMsg.innerText.includes(ind)) return true;
          }
        }
        return false;
      })();
    `
  }
}