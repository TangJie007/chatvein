import { Injectable, Logger } from '@electrum/common'
import { extname, basename, resolve } from 'node:path'
import { stat, readFile } from 'node:fs/promises'
import type { ChatSendInput } from '../../renderer/api/ipc-api'

/**
 * 文件服务：集中处理对话附件（文件上传）相关的逻辑。
 *
 * - 文本可读取扩展名白名单与单文件上限
 * - 单附件文本读取（二进制 / 过大 / 读取失败回落）
 * - 把文本附件内容拼进用户消息，使模型能读到文件内容
 *
 * 原本散落在 ChatService 内的附件处理逻辑抽到此处，ChatService 只负责编排。
 */

/** 可作为文本读取并注入 prompt 的附件扩展名（其余视为二进制，仅保留路径） */
const ATTACHMENT_TEXT_EXTENSIONS = new Set<string>([
  'txt', 'text', 'md', 'markdown', 'mdx', 'rst', 'adoc', 'asciidoc', 'json', 'jsonl', 'json5',
  'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'config', 'env', 'csv', 'tsv', 'log', 'xml',
  'html', 'htm', 'xhtml', 'css', 'scss', 'less', 'sass', 'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx',
  'vue', 'svelte', 'astro', 'py', 'pyw', 'java', 'kt', 'kts', 'go', 'rs', 'rb', 'php', 'sh', 'bash',
  'zsh', 'ps1', 'bat', 'cmd', 'sql', 'r', 'swift', 'dart', 'lua', 'pl', 'pm', 'scala', 'gradle',
  'groovy', 'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hh', 'm', 'mm', 'cs', 'vb', 'asm', 'dockerfile',
  'gitignore', 'editorconfig', 'npmrc', 'properties', 'tf', 'tfvars', 'ipynb', 'graphql', 'gql',
])
const ATTACHMENT_MAX_BYTES = 256 * 1024

@Injectable()
export class FilesService {
  private readonly logger = new Logger('FilesService')

  /** 单文件附件读取上限（字节），超出视为「过大」不注入内容 */
  get maxBytes(): number {
    return ATTACHMENT_MAX_BYTES
  }

  /**
   * 读取单个文本附件内容；二进制 / 过大 / 读取失败返回 null，过大返回 '__too_large__'。
   * 调用方据此拼接提示文案或回落到仅保留路径。
   */
  async readAttachmentText(absPath: string): Promise<string | null> {
    try {
      const ext = extname(absPath).slice(1).toLowerCase()
      if (!ATTACHMENT_TEXT_EXTENSIONS.has(ext)) return null
      const info = await stat(absPath)
      if (!info.isFile()) return null
      if (info.size > ATTACHMENT_MAX_BYTES) return '__too_large__'
      return await readFile(absPath, 'utf8')
    } catch {
      return null
    }
  }

  /**
   * 把文本附件内容拼接到用户消息，使模型能读到文件内容（异常时回落到原文）。
   * 二进制 / 过大 / 不可读的附件只保留路径提示（编程模式可用工具自行打开）。
   */
  async augmentUserContent(input: ChatSendInput): Promise<string> {
    const base = (input.content ?? '').trim()
    const atts = (input.attachments ?? []).filter((a) => a.path && a.path.trim())
    if (!atts.length) return base
    const parts: string[] = []
    for (const a of atts) {
      const name = a.name || basename(a.path!)
      const text = await this.readAttachmentText(resolve(a.path!))
      if (text === '__too_large__') {
        parts.push(
          `[附件「${name}」超过 ${Math.floor(ATTACHMENT_MAX_BYTES / 1024)}KB，已跳过内容读取]`,
        )
      } else if (text === null) {
        parts.push(`[附件「${name}」为二进制或不可读文件，已保留路径 ${a.path}（编程模式可用工具打开）]`)
      } else if (text.trim()) {
        parts.push(`[附件「${name}」内容开始]\n${text}\n[附件「${name}」内容结束]`)
      } else {
        parts.push(`[附件「${name}」为空文件]`)
      }
    }
    if (!parts.length) return base
    return `${base ? base + '\n\n' : ''}以下为本次附加的文件内容：\n\n${parts.join('\n\n')}`
  }
}
