/** 把 Vue 响应式等不可克隆对象打成 IPC 可传的纯 JSON 数据 */
export function toIpcPayload<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
