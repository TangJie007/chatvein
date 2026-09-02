import { describe, it, expect, vi } from 'vitest'
import {
  Module,
  Injectable,
  Controller,
  IpcHandle,
  IpcEmit,
  Inject,
  META,
  readMetadata,
  type InjectionPoint,
} from '@electrum/common'
import { DIContainer } from '../di/container'

@Injectable()
class TestService {}

@Controller('test')
class TestController {
  @Inject(TestService) svc!: TestService

  @IpcHandle('action')
  doAction() {
    return 'ok'
  }
}

@Controller({ prefix: 'file', window: 'main' })
class FileEmitController {
  @IpcEmit('saved')
  notifySaved!: (path: string) => void

  @IpcEmit('toast', { window: 'broadcast' })
  toastAll!: (msg: string) => void
}

@Module({
  controllers: [TestController, FileEmitController],
  providers: [TestService],
})
class TestModule {}

describe('TS5 Decorator Metadata', () => {
  it('stores module metadata', () => {
    const meta = readMetadata<{ controllers: Function[] }>(TestModule, META.MODULE)
    expect(meta?.controllers).toContain(TestController)
  })

  it('stores controller prefix', () => {
    const meta = readMetadata<{ prefix: string }>(TestController, META.CONTROLLER)
    expect(meta?.prefix).toBe('test')
  })

  it('stores controller options object', () => {
    const meta = readMetadata<{ prefix: string; window?: string }>(
      FileEmitController,
      META.CONTROLLER,
    )
    expect(meta?.prefix).toBe('file')
    expect(meta?.window).toBe('main')
  })

  it('stores IPC handle methods', () => {
    const handlers = readMetadata<{ channel: string }[]>(TestController, META.IPC_HANDLE)
    expect(handlers).toHaveLength(1)
    expect(handlers![0].channel).toBe('action')
  })

  it('stores injection points', () => {
    const injections = readMetadata<{ token: Function }[]>(TestController, META.INJECTIONS)
    expect(injections).toHaveLength(1)
    expect(injections![0].token).toBe(TestService)
  })

  it('stores IpcEmit injection points', () => {
    const injections = readMetadata<InjectionPoint[]>(FileEmitController, META.INJECTIONS)
    expect(injections).toHaveLength(2)
    expect(injections![0]).toMatchObject({
      type: 'emit',
      emitChannel: 'saved',
      propertyKey: 'notifySaved',
    })
    expect(injections![1]).toMatchObject({
      type: 'emit',
      emitChannel: 'toast',
      emitWindow: 'broadcast',
      propertyKey: 'toastAll',
    })
  })
})

describe('@IpcEmit injection', () => {
  it('calls windowSender with resolved target and channel', () => {
    const sender = vi.fn()
    const container = new DIContainer()
    container.setWindowSender(sender)
    container.register(FileEmitController)

    const instance = container.resolve<FileEmitController>(FileEmitController)
    instance.notifySaved('/tmp/a.txt')
    instance.toastAll('hi')

    expect(sender).toHaveBeenCalledWith('main', 'file:saved', '/tmp/a.txt')
    expect(sender).toHaveBeenCalledWith('broadcast', 'file:toast', 'hi')
  })
})
