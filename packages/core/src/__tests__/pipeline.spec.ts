import { describe, it, expect, vi } from 'vitest'
import {
  Controller,
  IpcHandle,
  UseFilters,
  UseGuards,
  UsePipes,
  UseInterceptors,
  ForbiddenException,
  NotFoundException,
  type CanActivate,
  type ExceptionFilter,
  type IpcContext,
  type IpcErrorResponse,
  type NestInterceptor,
  type PipeTransform,
} from '@electrum/common'
import { DIContainer } from '../di/container'
import { MiddlewarePipeline } from '../middleware/pipeline'

class MethodOnlyFilter implements ExceptionFilter {
  catch(_exception: unknown, _context: IpcContext): IpcErrorResponse {
    return { __error: true, code: 'METHOD_FILTER', message: 'handled by method filter' }
  }
}

@Controller('demo')
class DemoController {
  @IpcHandle('read')
  @UseFilters(MethodOnlyFilter)
  read() {
    throw new NotFoundException('file')
  }

  @IpcHandle('missing')
  missing() {
    throw new NotFoundException('file')
  }

  @IpcHandle('write')
  write() {
    throw new ForbiddenException('denied')
  }
}

describe('MiddlewarePipeline.runFilters', () => {
  it('serializes ElectronException with correct code when no filter is registered', async () => {
    const container = new DIContainer()
    const pipeline = new MiddlewarePipeline(container)
    const instance = new DemoController()

    const result = await pipeline.execute({
      type: 'handle',
      instance,
      method: 'write',
      controllerClass: DemoController,
      channel: 'demo:write',
      event: {} as any,
      args: [],
    })

    expect(result).toEqual({
      __error: true,
      code: 'FORBIDDEN',
      message: 'denied',
    })
  })

  it('serializes NotFoundException with correct code when no filter is registered', async () => {
    const container = new DIContainer()
    const pipeline = new MiddlewarePipeline(container)
    const instance = new DemoController()

    const result = await pipeline.execute({
      type: 'handle',
      instance,
      method: 'missing',
      controllerClass: DemoController,
      channel: 'demo:missing',
      event: {} as any,
      args: [],
    })

    expect(result).toEqual({
      __error: true,
      code: 'NOT_FOUND',
      message: 'file not found',
    })
  })

  it('applies method-level @UseFilters by handler method name, not IPC channel', async () => {
    const container = new DIContainer()
    container.register(MethodOnlyFilter, { useClass: MethodOnlyFilter })
    const pipeline = new MiddlewarePipeline(container)
    const instance = new DemoController()

    const result = await pipeline.execute({
      type: 'handle',
      instance,
      method: 'read',
      controllerClass: DemoController,
      channel: 'demo:read',
      event: {} as any,
      args: [],
    })

    expect(result).toEqual({
      __error: true,
      code: 'METHOD_FILTER',
      message: 'handled by method filter',
    })
  })
})

class DenyGuard implements CanActivate {
  canActivate(): boolean {
    return false
  }
}

class AllowGuard implements CanActivate {
  canActivate(): boolean {
    return true
  }
}

class UppercasePipe implements PipeTransform {
  transform(value: unknown): unknown {
    return typeof value === 'string' ? value.toUpperCase() : value
  }
}

class PrefixPipe implements PipeTransform {
  transform(value: unknown): unknown {
    return `pre:${value}`
  }
}

@Controller('pipe')
class PipeController {
  lastArgs: unknown[] = []

  @IpcHandle('echo')
  @UsePipes(UppercasePipe)
  echo(value: string) {
    this.lastArgs = [value]
    return value
  }
}

@Controller('guard')
@UseGuards(AllowGuard)
class GuardController {
  @IpcHandle('ok')
  ok() {
    return 'ok'
  }

  @IpcHandle('deny')
  @UseGuards(DenyGuard)
  deny() {
    return 'should-not-run'
  }
}

@Controller('order')
@UseGuards(AllowGuard)
@UsePipes(PrefixPipe)
class OrderController {
  calls: string[] = []

  @IpcHandle('run')
  @UseGuards(AllowGuard)
  @UsePipes(UppercasePipe)
  run(value: string) {
    this.calls.push(`handler:${value}`)
    return value
  }
}

@Controller('on')
class OnController {
  events: unknown[] = []

  @UseGuards(DenyGuard)
  onDenied(_event: unknown, _payload: string) {
    this.events.push('should-not-run')
  }

  @UseGuards(AllowGuard)
  onAllowed(event: unknown, payload: string) {
    this.events.push({ event, payload })
  }
}

describe('MiddlewarePipeline.execute — Guard', () => {
  it('throws ForbiddenException when a Guard returns false', async () => {
    const container = new DIContainer()
    container.register(DenyGuard, { useClass: DenyGuard })
    container.register(AllowGuard, { useClass: AllowGuard })
    const pipeline = new MiddlewarePipeline(container)
    const instance = new GuardController()

    const result = await pipeline.execute({
      type: 'handle',
      instance,
      method: 'deny',
      controllerClass: GuardController,
      channel: 'guard:deny',
      event: {} as any,
      args: [],
    })

    expect(result).toMatchObject({
      __error: true,
      code: 'FORBIDDEN',
    })
    expect(String(result.message)).toContain('DenyGuard')
  })

  it('allows the handler when all Guards return true', async () => {
    const container = new DIContainer()
    container.register(AllowGuard, { useClass: AllowGuard })
    const pipeline = new MiddlewarePipeline(container)
    const instance = new GuardController()

    const result = await pipeline.execute({
      type: 'handle',
      instance,
      method: 'ok',
      controllerClass: GuardController,
      channel: 'guard:ok',
      event: {} as any,
      args: [],
    })

    expect(result).toBe('ok')
  })
})

describe('MiddlewarePipeline.execute — Pipe', () => {
  it('transforms args[0] before invoking the controller method', async () => {
    const container = new DIContainer()
    container.register(UppercasePipe, { useClass: UppercasePipe })
    const pipeline = new MiddlewarePipeline(container)
    const instance = new PipeController()

    const result = await pipeline.execute({
      type: 'handle',
      instance,
      method: 'echo',
      controllerClass: PipeController,
      channel: 'pipe:echo',
      event: {} as any,
      args: ['hello'],
    })

    expect(result).toBe('HELLO')
    expect(instance.lastArgs).toEqual(['HELLO'])
  })

  it('applies pipes in global → class → method order', async () => {
    const container = new DIContainer()
    container.register(PrefixPipe, { useClass: PrefixPipe })
    container.register(UppercasePipe, { useClass: UppercasePipe })
    container.register(AllowGuard, { useClass: AllowGuard })
    const pipeline = new MiddlewarePipeline(container)
    pipeline.useGlobalPipes(PrefixPipe)
    const instance = new OrderController()

    // global PrefixPipe then class PrefixPipe then method UppercasePipe
    // input "ab" → pre:ab → pre:pre:ab → PRE:PRE:AB
    const result = await pipeline.execute({
      type: 'handle',
      instance,
      method: 'run',
      controllerClass: OrderController,
      channel: 'order:run',
      event: {} as any,
      args: ['ab'],
    })

    expect(result).toBe('PRE:PRE:AB')
    expect(instance.calls).toEqual(['handler:PRE:PRE:AB'])
  })
})

class GlobalInterceptor implements NestInterceptor {
  static orderRef: string[] = []
  async intercept(_ctx: IpcContext, next: () => Promise<unknown>) {
    GlobalInterceptor.orderRef.push('global:before')
    const result = await next()
    GlobalInterceptor.orderRef.push('global:after')
    return result
  }
}

class ClassInterceptor implements NestInterceptor {
  async intercept(_ctx: IpcContext, next: () => Promise<unknown>) {
    GlobalInterceptor.orderRef.push('class:before')
    const result = await next()
    GlobalInterceptor.orderRef.push('class:after')
    return result
  }
}

class MethodInterceptor implements NestInterceptor {
  async intercept(_ctx: IpcContext, next: () => Promise<unknown>) {
    GlobalInterceptor.orderRef.push('method:before')
    const result = await next()
    GlobalInterceptor.orderRef.push('method:after')
    return result
  }
}

@Controller('onion')
@UseInterceptors(ClassInterceptor)
class OnionController {
  @IpcHandle('run')
  @UseInterceptors(MethodInterceptor)
  run() {
    GlobalInterceptor.orderRef.push('handler')
    return 'ok'
  }
}

describe('MiddlewarePipeline.execute — Interceptor onion', () => {
  it('runs interceptors as global → class → method around the handler', async () => {
    GlobalInterceptor.orderRef = []

    const container = new DIContainer()
    container.register(GlobalInterceptor, { useClass: GlobalInterceptor })
    container.register(ClassInterceptor, { useClass: ClassInterceptor })
    container.register(MethodInterceptor, { useClass: MethodInterceptor })
    const pipeline = new MiddlewarePipeline(container)
    pipeline.useGlobalInterceptors(GlobalInterceptor)
    const instance = new OnionController()

    const result = await pipeline.execute({
      type: 'handle',
      instance,
      method: 'run',
      controllerClass: OnionController,
      channel: 'onion:run',
      event: {} as any,
      args: [],
    })

    expect(result).toBe('ok')
    expect(GlobalInterceptor.orderRef).toEqual([
      'global:before',
      'class:before',
      'method:before',
      'handler',
      'method:after',
      'class:after',
      'global:after',
    ])
  })
})

describe('MiddlewarePipeline.executeGuardOnly — @IpcOn path', () => {
  it('skips the handler when a Guard denies access', async () => {
    const container = new DIContainer()
    container.register(DenyGuard, { useClass: DenyGuard })
    const pipeline = new MiddlewarePipeline(container)
    const instance = new OnController()

    await pipeline.executeGuardOnly({
      type: 'on',
      instance,
      method: 'onDenied',
      controllerClass: OnController,
      channel: 'on:denied',
      event: { id: 1 },
      args: ['payload'],
    })

    expect(instance.events).toEqual([])
  })

  it('passes the IPC event as the first argument to the handler', async () => {
    const container = new DIContainer()
    container.register(AllowGuard, { useClass: AllowGuard })
    const pipeline = new MiddlewarePipeline(container)
    const instance = new OnController()
    const event = { id: 42 }

    await pipeline.executeGuardOnly({
      type: 'on',
      instance,
      method: 'onAllowed',
      controllerClass: OnController,
      channel: 'on:allowed',
      event,
      args: ['hello'],
    })

    expect(instance.events).toEqual([{ event, payload: 'hello' }])
  })

  it('swallows handler errors without throwing', async () => {
    @Controller('boom')
    class BoomController {
      @UseGuards(AllowGuard)
      explode() {
        throw new Error('boom')
      }
    }

    const container = new DIContainer()
    container.register(AllowGuard, { useClass: AllowGuard })
    const pipeline = new MiddlewarePipeline(container)
    const errorSpy = vi.spyOn((pipeline as any).logger, 'error').mockImplementation(() => {})

    await expect(
      pipeline.executeGuardOnly({
        type: 'on',
        instance: new BoomController(),
        method: 'explode',
        controllerClass: BoomController,
        channel: 'boom:explode',
        event: {},
        args: [],
      }),
    ).resolves.toBeUndefined()

    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})
