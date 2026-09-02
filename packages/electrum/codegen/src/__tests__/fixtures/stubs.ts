export function Controller(_target: string | { prefix?: string }): ClassDecorator {
  return () => {}
}

export function IpcHandle(_channel: string, _options?: { devOnly?: boolean }): MethodDecorator {
  return () => {}
}
