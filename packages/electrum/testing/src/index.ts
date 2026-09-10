export { TestContainer, createTestContainer } from './test-container'
export { mockElectron, MockBrowserWindow } from './mock-electron'
export type {
  MockElectron,
  MockIpcHandler,
  MockIpcListener,
  MockAppListener,
  MockBrowserWindowOptions,
} from './mock-electron'

/** Re-export metadata helpers for decorator assertion tests */
export { META, readMetadata, getClassMetadata } from '@electrum/common'
