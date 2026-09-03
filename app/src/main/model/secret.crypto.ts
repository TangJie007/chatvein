import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { app, safeStorage } from 'electron'

const ENC_PREFIX = 'enc:v1:'
const LEGACY_PLAIN_PREFIX = 'plain:'

/**
 * API Key 落盘加密。
 * 优先 Electron safeStorage（Windows DPAPI / macOS Keychain）；
 * 不可用时回退到本机 AES-256-GCM（密钥文件在 userData/forge/.secret-key）。
 */
export async function sealApiKey(plain: string): Promise<string> {
  if (!plain) return ''
  if (safeStorage.isEncryptionAvailable()) {
    return ENC_PREFIX + safeStorage.encryptString(plain).toString('base64')
  }
  const buf = await fallbackEncrypt(plain)
  return ENC_PREFIX + 'fb:' + buf
}

export async function openApiKey(sealed: string): Promise<string> {
  if (!sealed) return ''
  // 兼容旧版明文落盘
  if (!sealed.startsWith(ENC_PREFIX) && !sealed.startsWith(LEGACY_PLAIN_PREFIX)) {
    return sealed
  }
  if (sealed.startsWith(LEGACY_PLAIN_PREFIX)) {
    return sealed.slice(LEGACY_PLAIN_PREFIX.length)
  }

  const payload = sealed.slice(ENC_PREFIX.length)
  if (payload.startsWith('fb:')) {
    return fallbackDecrypt(payload.slice(3))
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('系统加密不可用，无法解密 API Key')
  }
  return safeStorage.decryptString(Buffer.from(payload, 'base64'))
}

async function fallbackKey(): Promise<Buffer> {
  const keyPath = join(app.getPath('userData'), 'forge', '.secret-key')
  try {
    const raw = await fs.readFile(keyPath)
    if (raw.length === 32) return raw
  } catch {
    // create below
  }
  await mkdir(dirname(keyPath), { recursive: true })
  const key = randomBytes(32)
  await fs.writeFile(keyPath, key, { mode: 0o600 })
  return key
}

async function fallbackEncrypt(plain: string): Promise<string> {
  const key = await fallbackKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString('base64')
}

async function fallbackDecrypt(payload: string): Promise<string> {
  const key = await fallbackKey()
  const buf = Buffer.from(payload, 'base64')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const data = buf.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}

/** 仅用于调试日志：哈希前缀，绝不打印明文 */
export function apiKeyFingerprint(plain: string): string {
  if (!plain) return '(empty)'
  return createHash('sha256').update(plain).digest('hex').slice(0, 8)
}
