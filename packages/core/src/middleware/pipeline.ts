import {
  META,
  readMetadata,
  Logger,
  ForbiddenException,
  type CanActivate,
  type IpcContext,
  type NestInterceptor,
  type PipeTransform,
  type ExceptionFilter,
  type IpcErrorResponse,
  type MethodMiddlewareEntry,
} from '@electrum/common'
import type { DIContainer } from '../di/container'

export interface PipelineExecutionContext {
  type: 'handle' | 'on'
  instance: any
  method: string | symbol
  controllerClass: Function
  channel: string
  event: any
  args: any[]
}

export class MiddlewarePipeline {
  private logger = new Logger('Pipeline')
  private globalFilters: Function[] = []
  private globalGuards: Function[] = []
  private globalPipes: Function[] = []
  private globalInterceptors: Function[] = []

  constructor(private container: DIContainer) {}

  useGlobalFilters(...filters: Function[]): void {
    this.globalFilters.push(...filters)
  }
  useGlobalGuards(...guards: Function[]): void {
    this.globalGuards.push(...guards)
  }
  useGlobalPipes(...pipes: Function[]): void {
    this.globalPipes.push(...pipes)
  }
  useGlobalInterceptors(...interceptors: Function[]): void {
    this.globalInterceptors.push(...interceptors)
  }

  async execute(ctx: PipelineExecutionContext): Promise<any> {
    const context: IpcContext = {
      channel: ctx.channel,
      event: ctx.event,
      args: ctx.args,
      controllerClass: ctx.controllerClass,
      instance: ctx.instance,
    }

    try {
      await this.runGuards(ctx, context)
      const transformedArgs = await this.runPipes(ctx, context)
      return await this.runWithInterceptors(ctx, context, transformedArgs)
    } catch (err) {
      return this.runFilters(err, context)
    }
  }

  async executeGuardOnly(ctx: PipelineExecutionContext): Promise<void> {
    const context: IpcContext = {
      channel: ctx.channel,
      event: ctx.event,
      args: ctx.args,
      controllerClass: ctx.controllerClass,
      instance: ctx.instance,
    }
    try {
      await this.runGuards(ctx, context)
      await ctx.instance[ctx.method](ctx.event, ...ctx.args)
    } catch (err) {
      this.logger.error(`Guard/method error on "${ctx.channel}": ${err}`)
    }
  }

  private async runGuards(ctx: PipelineExecutionContext, context: IpcContext): Promise<void> {
    const classGuards = readMetadata<Function[]>(ctx.controllerClass, META.CLASS_GUARDS) || []
    const methodEntries =
      readMetadata<MethodMiddlewareEntry[]>(ctx.controllerClass, META.METHOD_GUARDS) || []
    const methodEntry = methodEntries.find((e) => e.method === ctx.method)
    const methodGuards = methodEntry?.middlewares || []

    const allGuards = [...this.globalGuards, ...classGuards, ...methodGuards]

    for (const guardClass of allGuards) {
      const guard = this.container.resolve(guardClass) as CanActivate
      const canActivate = await guard.canActivate(context)
      if (!canActivate) {
        throw new ForbiddenException(
          `Guard ${guardClass.name} denied access to "${ctx.channel}"`,
        )
      }
    }
  }

  private async runPipes(ctx: PipelineExecutionContext, context: IpcContext): Promise<any[]> {
    const classPipes = readMetadata<Function[]>(ctx.controllerClass, META.CLASS_PIPES) || []
    const methodEntries =
      readMetadata<MethodMiddlewareEntry[]>(ctx.controllerClass, META.METHOD_PIPES) || []
    const methodEntry = methodEntries.find((e) => e.method === ctx.method)
    const methodPipes = methodEntry?.middlewares || []

    const allPipes = [...this.globalPipes, ...classPipes, ...methodPipes]

    let args = [...ctx.args]
    for (const pipeClass of allPipes) {
      const pipe = this.container.resolve(pipeClass) as PipeTransform
      if (args.length > 0) {
        args[0] = await pipe.transform(args[0], context)
      }
    }
    return args
  }

  private async runWithInterceptors(
    ctx: PipelineExecutionContext,
    context: IpcContext,
    args: any[],
  ): Promise<any> {
    const classInterceptors =
      readMetadata<Function[]>(ctx.controllerClass, META.CLASS_INTERCEPTORS) || []
    const methodEntries =
      readMetadata<MethodMiddlewareEntry[]>(ctx.controllerClass, META.METHOD_INTERCEPTORS) ||
      []
    const methodEntry = methodEntries.find((e) => e.method === ctx.method)
    const methodInterceptors = methodEntry?.middlewares || []

    const allInterceptors = [
      ...this.globalInterceptors,
      ...classInterceptors,
      ...methodInterceptors,
    ]

    const executeController = () => Promise.resolve(ctx.instance[ctx.method](...args))

    if (allInterceptors.length === 0) return executeController()

    let chain = executeController
    for (let i = allInterceptors.length - 1; i >= 0; i--) {
      const interceptor = this.container.resolve(allInterceptors[i]) as NestInterceptor
      const next = chain
      chain = () => interceptor.intercept(context, next)
    }
    return chain()
  }

  private runFilters(exception: unknown, context: IpcContext): IpcErrorResponse {
    const classFilters = readMetadata<Function[]>(context.controllerClass, META.CLASS_FILTERS) || []
    const methodEntries =
      readMetadata<MethodMiddlewareEntry[]>(context.controllerClass, META.METHOD_FILTERS) || []
    const methodEntry = methodEntries.find((e) => e.method === context.channel)
    const methodFilters = methodEntry?.middlewares || []

    const allFilters = [...methodFilters, ...classFilters, ...this.globalFilters]

    for (const filterClass of allFilters) {
      const filter = this.container.resolve(filterClass) as ExceptionFilter
      return filter.catch(exception, context)
    }

    if (exception instanceof Error) {
      return {
        __error: true,
        code: 'INTERNAL',
        message: exception.message,
        ...(process.env.NODE_ENV?.includes('dev') ? { stack: exception.stack } : {}),
      }
    }
    return { __error: true, code: 'UNKNOWN', message: 'An unknown error occurred' }
  }
}
