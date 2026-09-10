/**
 * 寒暄 / 自我介绍（高置信 → direct·general）。
 * 迁自旧 L1：只对「整句几乎只有寒暄」短路，避免「你好，帮我改 bug」误判。
 */

const GREETINGS = [
  '你好',
  '您好',
  '早上好',
  '上午好',
  '中午好',
  '下午好',
  '晚上好',
  '深夜好',
  '嗨',
  '哈喽',
  '哈啰',
  '在吗',
  '在不在',
  '喂',
  '你在吗',
  '在么',
  '谢谢',
  '感谢',
  '多谢',
  '辛苦了',
  '再见',
  '拜拜',
  '拜',
  'hello',
  'hi',
  'hey',
  'thanks',
  'thank you',
  'bye',
]

const PARTICLES = ['啊', '呀', '吧', '呢', '嘛', '哦', '噢', '啦', '哟', '哇']
const SELF_INTRO_PREFIXES = ['我叫', '我是']
const NAME_REST_RE = /^[\u4e00-\u9fffA-Za-z·]{1,8}$/
const NOT_NAME_RE = /[的了着过来去要帮写改做查看搜修跑什么谁啥哪吗么呢]|代码|文件|登录|问题/

export function isGreetingOnly(textNorm: string): boolean {
  let s = textNorm.replace(/[\s\p{P}\p{S}]+/gu, '').toLowerCase()
  if (!s) return false
  for (const p of PARTICLES) {
    if (s.endsWith(p)) s = s.slice(0, -p.length)
  }
  if (!s) return false
  for (const g of [...GREETINGS].sort((a, b) => b.length - a.length)) {
    if (s === g.replace(/\s+/g, '')) return true
  }
  return false
}

export function isSelfIntro(textNorm: string): boolean {
  if (/[？?]/.test(textNorm)) return false
  const s = textNorm.replace(/[\s\p{P}\p{S}]+/gu, '')
  if (!s) return false
  for (const p of [...SELF_INTRO_PREFIXES].sort((a, b) => b.length - a.length)) {
    if (!s.startsWith(p)) continue
    const rest = s.slice(p.length)
    if (NAME_REST_RE.test(rest) && !NOT_NAME_RE.test(rest)) return true
  }
  return false
}
