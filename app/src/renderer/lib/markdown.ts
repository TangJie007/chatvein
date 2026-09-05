/**
 * 对话 Markdown 渲染（design/08）：markdown-it + highlight.js + DOMPurify。
 * 仅用于 app renderer；不进 @chatvein/*。
 */
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import json from 'highlight.js/lib/languages/json'
import xml from 'highlight.js/lib/languages/xml'
import css from 'highlight.js/lib/languages/css'
import bash from 'highlight.js/lib/languages/bash'
import python from 'highlight.js/lib/languages/python'
import markdown from 'highlight.js/lib/languages/markdown'
import sql from 'highlight.js/lib/languages/sql'
import yaml from 'highlight.js/lib/languages/yaml'

hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('js', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('ts', typescript)
hljs.registerLanguage('json', json)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('css', css)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('shell', bash)
hljs.registerLanguage('sh', bash)
hljs.registerLanguage('python', python)
hljs.registerLanguage('py', python)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('md', markdown)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('yml', yaml)

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function highlight(str: string, lang: string): string {
  const name = lang.trim().toLowerCase()
  if (name && hljs.getLanguage(name)) {
    try {
      return `<pre class="hljs"><code class="language-${escapeHtml(name)}">${
        hljs.highlight(str, { language: name, ignoreIllegals: true }).value
      }</code></pre>`
    } catch {
      /* fall through */
    }
  }
  return `<pre class="hljs"><code>${escapeHtml(str)}</code></pre>`
}

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  highlight,
})

/** 流式渲染副本：补未闭合围栏 / 行内反引号 / 粗体，消除抖动 */
export function balanceMarkdown(src: string): string {
  let out = src
  if ((src.match(/```/g) ?? []).length % 2 === 1) out += '\n```'
  // 行内 `：排除围栏内的 ```；用简易奇数计数（设计草案）
  const inlineTicks = out.match(/(?<!`)`(?!`)/g) ?? []
  if (inlineTicks.length % 2 === 1) out += '`'
  if ((out.match(/\*\*/g) ?? []).length % 2 === 1) out += '**'
  return out
}

export function renderMarkdown(text: string, options?: { streaming?: boolean }): string {
  const src = options?.streaming ? balanceMarkdown(text) : text
  return DOMPurify.sanitize(md.render(src), {
    USE_PROFILES: { html: true },
  })
}
