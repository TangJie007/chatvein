declare module 'wink-bm25-text-search' {
  type PrepTask = (input: unknown) => unknown
  interface WinkBm25Engine {
    defineConfig: (config: object) => void
    definePrepTasks: (tasks: PrepTask[], field?: string) => number
    addDoc: (doc: object, uniqueId: string | number) => void
    learn: (doc: object, uniqueId: string | number) => void
    consolidate: (fp?: number) => void
    search: (
      text: string,
      limit?: number,
      filter?: (fieldValues: object, params: unknown) => boolean,
      params?: unknown,
    ) => Array<[string | number, number]>
    reset: () => void
  }
  const winkBm25TextSearch: () => WinkBm25Engine
  export default winkBm25TextSearch
}
