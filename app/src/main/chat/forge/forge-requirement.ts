/**
 * 将对话框输入（说明文字 ± 上传的需求文档）合成 Forge 可读的需求 Markdown。
 * 文件落在会话 workspace/memory，不写入项目根（赛事需求不绑定仓库）。
 */
import { basename } from 'node:path'
import { promises as fs } from 'node:fs'
import type { ChatAttachment } from '../chat.types'

const REQ_EXTS = new Set(['.md', '.markdown', '.txt', '.text'])
const MAX_DOC_CHARS = 400_000

export function isRequirementAttachment(a: ChatAttachment): boolean {
  if (a.kind === 'requirement') return true
  const n = (a.name || a.path).toLowerCase()
  return [...REQ_EXTS].some((ext) => n.endsWith(ext))
}

/** 展示用：气泡里附带附件名 */
export function formatUserContentWithAttachments(
  content: string,
  attachments: ChatAttachment[] | undefined,
): string {
  const text = content.trim()
  const files = (attachments ?? []).filter((a) => a.path?.trim())
  if (files.length === 0) return text
  const lines = files.map((a) => `📎 ${a.name || basename(a.path)}`)
  return text ? `${lines.join('\n')}\n\n${text}` : lines.join('\n')
}

/**
 * 合成需求正文并写入 destPath。
 * - 仅对话：用户说明即需求
 * - 上传文档：文档正文为主，用户说明为补充（可空）
 */
export async function writeForgeRequirementFile(opts: {
  destPath: string
  projectRoot: string
  userText: string
  attachments?: ChatAttachment[]
}): Promise<{ source: 'chat' | 'upload+chat' | 'upload'; attachmentNames: string[] }> {
  const userText = opts.userText.trim()
  const reqFiles = (opts.attachments ?? []).filter(
    (a) => a.path?.trim() && isRequirementAttachment(a),
  )

  const sections: string[] = []
  sections.push('# 编码任务说明')
  sections.push('')
  sections.push('> 本文由对话框生成，存放于会话 memory，**不是**项目仓库内文件。')
  sections.push('')
  sections.push(`- 工作区（真实项目根）：\`${opts.projectRoot}\``)
  sections.push('- 请在该工作区内完成实现与验证；不要把需求文档复制进项目，除非用户明确要求。')
  sections.push('')

  const attachmentNames: string[] = []
  if (reqFiles.length > 0) {
    sections.push('## 上传的需求文档')
    sections.push('')
    for (const a of reqFiles) {
      const name = a.name || basename(a.path)
      attachmentNames.push(name)
      let body = ''
      try {
        body = await fs.readFile(a.path, 'utf8')
      } catch (err) {
        throw new Error(`无法读取需求文档「${name}」：${(err as Error).message}`)
      }
      if (body.length > MAX_DOC_CHARS) {
        body = `${body.slice(0, MAX_DOC_CHARS)}\n\n…(文档过长，已截断)`
      }
      sections.push(`### 文件：${name}`)
      sections.push('')
      sections.push(body.trim() || '（空文件）')
      sections.push('')
    }
  }

  if (userText) {
    sections.push(reqFiles.length > 0 ? '## 用户补充说明' : '## 用户描述的需求')
    sections.push('')
    sections.push(userText)
    sections.push('')
  }

  if (!userText && reqFiles.length === 0) {
    throw new Error('请输入需求描述，或上传需求文档（.md / .txt）')
  }

  sections.push('## 执行约束')
  sections.push('')
  sections.push('- 按上述需求完成功能；不要发明无关业务模块（例如把「需求说明」理解成「需求管理系统」）。')
  sections.push('- 若是初始化/脚手架：只建约定目录与最小可运行骨架，并说明如何启动。')
  sections.push('- 优先最小必要改动；改完应可构建/测试验证（若项目尚无测试，先补最小冒烟再实现）。')
  sections.push('')

  await fs.mkdir(dirnameSafe(opts.destPath), { recursive: true })
  await fs.writeFile(opts.destPath, sections.join('\n'), 'utf8')

  const source =
    reqFiles.length > 0 && userText
      ? 'upload+chat'
      : reqFiles.length > 0
        ? 'upload'
        : 'chat'
  return { source, attachmentNames }
}

function dirnameSafe(p: string): string {
  const { dirname } = require('node:path') as typeof import('node:path')
  return dirname(p)
}
