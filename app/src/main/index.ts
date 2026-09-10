import { createApp } from '@electrum/core'
import { AppModule } from './app.module'

async function bootstrap(): Promise<void> {
  const app = createApp(AppModule)
  await app.start()
}

bootstrap().catch((err) => {
  console.error('[bootstrap] failed:', err)
  process.exit(1)
})
