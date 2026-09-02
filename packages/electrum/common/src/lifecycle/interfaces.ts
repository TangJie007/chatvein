export interface OnModuleInit {
  onModuleInit(): void | Promise<void>
}

export interface OnAppReady {
  onAppReady(): void | Promise<void>
}

export interface OnModuleDestroy {
  onModuleDestroy(): void | Promise<void>
}
