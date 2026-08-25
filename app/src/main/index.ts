import { createApp } from '@electrum/core'
import { AppModule } from './app.module'
import { LoggingInterceptor } from './interceptors/logging.interceptor'
import { GlobalExceptionFilter } from './filters/global-exception.filter'

async function bootstrap() {
  const app = createApp(AppModule)

  app.useGlobalInterceptors(LoggingInterceptor)
  app.useGlobalFilters(GlobalExceptionFilter)

  await app.start()
}

bootstrap().catch((err) => {
  console.error('[bootstrap] failed:', err)
  process.exit(1)
})
