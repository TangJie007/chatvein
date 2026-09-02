import { Controller, IpcHandle, Inject } from '@electrum/common'
import { DoubaoService, type DoubaoMessage, type DoubaoStatus, type DoubaoDiagnostic } from './doubao.service'

@Controller({ prefix: 'doubao', window: 'main' })
export class DoubaoController {
  @Inject(DoubaoService)
  doubao!: DoubaoService

  @IpcHandle('connect')
  async connect(): Promise<{ status: DoubaoStatus; preloadPath: string }> {
    const result = await this.doubao.connect()
    return { ...result, preloadPath: this.doubao.getPreloadPath() }
  }

  @IpcHandle('disconnect')
  disconnect(): void {
    this.doubao.disconnect()
  }

  @IpcHandle('status')
  status(): { status: DoubaoStatus; hasWebview: boolean } {
    return this.doubao.getStatus()
  }

  @IpcHandle('diagnose')
  async diagnose(): Promise<DoubaoDiagnostic> {
    return this.doubao.diagnose()
  }

  @IpcHandle('send')
  async send(data: { prompt: string; waitForCompletion?: boolean }): Promise<{
    ok: boolean
    error?: string
    messages?: DoubaoMessage[]
    xml?: string
  }> {
    const result = await this.doubao.sendPrompt(data.prompt)
    if (!result.ok) {
      return result
    }

    if (data.waitForCompletion !== false) {
      const { messages, xml } = await this.doubao.waitForCompletion()
      return { ok: true, messages, xml }
    }

    return { ok: true }
  }

  @IpcHandle('messages')
  async messages(): Promise<DoubaoMessage[]> {
    return this.doubao.extractMessages()
  }

  @IpcHandle('extract')
  async extract(): Promise<string> {
    return this.doubao.extractXml()
  }
}