import type { Application } from '../application'

export interface Plugin {
  name: string
  install(app: Application): void
  ready?(app: Application): void | Promise<void>
  destroy?(app: Application): void | Promise<void>
}
