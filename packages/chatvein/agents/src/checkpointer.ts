/**
 * 工作区级 LangGraph checkpointer：用 `node:sqlite` 持久化（与 `chat.db` 同源，无原生编译）。
 *
 * 照搬 `@langchain/langgraph-checkpoint` 自带的 `MemorySaver` 存储逻辑，仅把内存 Map
 * 换成本地 SQLite 表，从而让 LangGraph 的「每轮对话状态（消息轨迹）」跨进程持久化。
 *
 * 与自研短期记忆（`@chatvein/memory` 的摘要/窗口）是**不同层**：
 * - 自研压缩主导「每轮喂给模型的 history」（裁剪）
 * - 本 checkpointer 负责「LangGraph 工作记忆的持久化与 thread resume」（存储）
 *
 * 配合 `ChatService` 的「每轮先 `deleteThread(threadId)` 再 `invoke(完整压缩 history)`」，
 * thread 每轮从压缩 history 重置，回复行为与无状态范式完全一致；checkpointer 同时把
 * 本轮 agent 的完整消息轨迹落盘，支持跨进程持久化与崩溃恢复。
 */
import { DatabaseSync } from 'node:sqlite'
import {
  BaseCheckpointSaver,
  WRITES_IDX_MAP,
} from '@langchain/langgraph-checkpoint'
import type {
  Checkpoint,
  CheckpointListOptions,
  CheckpointMetadata,
  CheckpointTuple,
  PendingWrite,
} from '@langchain/langgraph-checkpoint'
import type { RunnableConfig } from '@langchain/core/runnables'

const POLLUTION_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

/** 校验 `configurable` 里的 key 不是原型污染键（与 MemorySaver 同款守卫） */
function assertSafeStorageKey(
  field: string,
  value: string | undefined,
  options: { allowEmpty?: boolean } = {},
): void {
  const { allowEmpty = false } = options
  if (typeof value !== 'string') {
    const observed =
      value === null
        ? 'null'
        : value === undefined
          ? 'undefined'
          : Array.isArray(value)
            ? 'array'
            : typeof value
    throw new Error(
      `Invalid configurable value for key "${field}": expected a string identifier (got ${observed}).`,
    )
  }
  if (!allowEmpty && value === '') {
    throw new Error(`Invalid configurable value for key "${field}": empty string is not permitted.`)
  }
  if (POLLUTION_KEYS.has(value)) {
    throw new Error(
      `Invalid configurable value for key "${field}": value "${value}" is reserved (would mutate Object.prototype).`,
    )
  }
}

export interface WorkspaceCheckpointerOptions {
  /** 持久化 SQLite 路径，建议 `{workspacePath}/memory/checkpoints.db` */
  dbPath: string
}

interface CheckpointRow {
  checkpoint_id: string
  checkpoint_blob: string
  metadata_blob: string
  parent_checkpoint_id: string | null
}

interface WriteRow {
  task_id: string
  channel: string
  value_blob: string
}

export class WorkspaceCheckpointer extends BaseCheckpointSaver {
  private db: DatabaseSync

  constructor(opts: WorkspaceCheckpointerOptions) {
    super()
    this.db = new DatabaseSync(opts.dbPath)
    this.db.exec('PRAGMA foreign_keys = ON;')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS langgraph_checkpoints (
        thread_id TEXT NOT NULL,
        checkpoint_ns TEXT NOT NULL DEFAULT '',
        checkpoint_id TEXT NOT NULL,
        checkpoint_blob TEXT NOT NULL,
        metadata_blob TEXT NOT NULL,
        parent_checkpoint_id TEXT,
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
      );
      CREATE TABLE IF NOT EXISTS langgraph_checkpoint_writes (
        thread_id TEXT NOT NULL,
        checkpoint_ns TEXT NOT NULL DEFAULT '',
        checkpoint_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        idx INTEGER NOT NULL,
        channel TEXT NOT NULL,
        value_blob TEXT NOT NULL,
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
      );
      CREATE INDEX IF NOT EXISTS idx_lg_cp_thread ON langgraph_checkpoints(thread_id, checkpoint_ns);
      CREATE INDEX IF NOT EXISTS idx_lg_cw_thread ON langgraph_checkpoint_writes(thread_id, checkpoint_ns, checkpoint_id);
    `)
  }

  /** 释放数据库连接（会话删除时调用） */
  close(): void {
    try {
      this.db.close()
    } catch {
      // ignore
    }
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = config.configurable?.thread_id
    const ns = config.configurable?.checkpoint_ns ?? ''
    const checkpointId = config.configurable?.checkpoint_id || config.configurable?.thread_ts || ''
    if (threadId !== undefined) assertSafeStorageKey('thread_id', threadId)
    assertSafeStorageKey('checkpoint_ns', ns, { allowEmpty: true })
    if (checkpointId) assertSafeStorageKey('checkpoint_id', checkpointId)

    let row: CheckpointRow | undefined
    if (checkpointId) {
      row = this.db
        .prepare(
          `SELECT checkpoint_id, checkpoint_blob, metadata_blob, parent_checkpoint_id
           FROM langgraph_checkpoints WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?`,
        )
        .get(threadId, ns, checkpointId) as CheckpointRow | undefined
    } else if (threadId !== undefined) {
      row = this.db
        .prepare(
          `SELECT checkpoint_id, checkpoint_blob, metadata_blob, parent_checkpoint_id
           FROM langgraph_checkpoints WHERE thread_id = ? AND checkpoint_ns = ?
           ORDER BY checkpoint_id DESC LIMIT 1`,
        )
        .get(threadId, ns) as CheckpointRow | undefined
    }
    if (!row) return undefined

    const checkpoint = (await this.serde.loadsTyped('json', row.checkpoint_blob)) as Checkpoint
    const metadata = (await this.serde.loadsTyped('json', row.metadata_blob)) as CheckpointMetadata
    const pendingWrites = await this.loadWrites(threadId as string, ns, row.checkpoint_id)
    const tuple: CheckpointTuple = {
      config: {
        configurable: { thread_id: threadId, checkpoint_ns: ns, checkpoint_id: row.checkpoint_id },
      },
      checkpoint,
      metadata,
      pendingWrites,
    }
    if (row.parent_checkpoint_id) {
      tuple.parentConfig = {
        configurable: {
          thread_id: threadId,
          checkpoint_ns: ns,
          checkpoint_id: row.parent_checkpoint_id,
        },
      }
    }
    return tuple
  }

  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions,
  ): AsyncGenerator<CheckpointTuple> {
    const { before, limit, filter } = options ?? {}
    const threadId = config.configurable?.thread_id
    const ns = config.configurable?.checkpoint_ns ?? ''
    if (threadId !== undefined) assertSafeStorageKey('thread_id', threadId)
    if (config.configurable?.checkpoint_ns !== undefined) {
      assertSafeStorageKey('checkpoint_ns', config.configurable.checkpoint_ns, { allowEmpty: true })
    }
    if (config.configurable?.checkpoint_id) {
      assertSafeStorageKey('checkpoint_id', config.configurable.checkpoint_id)
    }
    if (before?.configurable?.checkpoint_id) {
      assertSafeStorageKey('checkpoint_id', before.configurable.checkpoint_id)
    }

    const threadIds = threadId ? [threadId] : this.allThreadIds()
    let remaining = limit ?? Number.POSITIVE_INFINITY
    for (const tid of threadIds) {
      const rows = this.db
        .prepare(
          `SELECT checkpoint_id, checkpoint_blob, metadata_blob, parent_checkpoint_id
           FROM langgraph_checkpoints WHERE thread_id = ? AND checkpoint_ns = ?
           ORDER BY checkpoint_id DESC`,
        )
        .all(tid, ns) as unknown as CheckpointRow[]
      for (const row of rows) {
        if (config.configurable?.checkpoint_id && row.checkpoint_id !== config.configurable.checkpoint_id) {
          continue
        }
        if (before?.configurable?.checkpoint_id && row.checkpoint_id >= before.configurable.checkpoint_id) {
          continue
        }
        const metadata = (await this.serde.loadsTyped('json', row.metadata_blob)) as CheckpointMetadata
        const metaRec = metadata as Record<string, unknown>
        if (filter && !Object.entries(filter).every(([k, v]) => metaRec[k] === v)) continue
        if (remaining <= 0) return
        remaining -= 1
        const checkpoint = (await this.serde.loadsTyped('json', row.checkpoint_blob)) as Checkpoint
        const pendingWrites = await this.loadWrites(tid, ns, row.checkpoint_id)
        const tuple: CheckpointTuple = {
          config: {
            configurable: { thread_id: tid, checkpoint_ns: ns, checkpoint_id: row.checkpoint_id },
          },
          checkpoint,
          metadata,
          pendingWrites,
        }
        if (row.parent_checkpoint_id) {
          tuple.parentConfig = {
            configurable: { thread_id: tid, checkpoint_ns: ns, checkpoint_id: row.parent_checkpoint_id },
          }
        }
        yield tuple
      }
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
  ): Promise<RunnableConfig> {
    const threadId = config.configurable?.thread_id
    const ns = config.configurable?.checkpoint_ns ?? ''
    if (threadId === undefined) {
      throw new Error('Failed to put checkpoint. The passed RunnableConfig is missing a required "thread_id".')
    }
    assertSafeStorageKey('thread_id', threadId)
    assertSafeStorageKey('checkpoint_ns', ns, { allowEmpty: true })
    assertSafeStorageKey('checkpoint_id', checkpoint.id)

    const serializedCheckpoint = await this.dumpsToString(checkpoint)
    const serializedMetadata = await this.dumpsToString(metadata)

    this.db
      .prepare(
        `INSERT OR REPLACE INTO langgraph_checkpoints
         (thread_id, checkpoint_ns, checkpoint_id, checkpoint_blob, metadata_blob, parent_checkpoint_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(threadId, ns, checkpoint.id, serializedCheckpoint, serializedMetadata, config.configurable?.checkpoint_id ?? null)

    return { configurable: { thread_id: threadId, checkpoint_ns: ns, checkpoint_id: checkpoint.id } }
  }

  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string,
  ): Promise<void> {
    const threadId = config.configurable?.thread_id
    const ns = config.configurable?.checkpoint_ns ?? ''
    const checkpointId = config.configurable?.checkpoint_id
    if (threadId === undefined) {
      throw new Error('Failed to put writes. The passed RunnableConfig is missing a required "thread_id".')
    }
    if (checkpointId === undefined) {
      throw new Error('Failed to put writes. The passed RunnableConfig is missing a required "checkpoint_id".')
    }
    assertSafeStorageKey('thread_id', threadId)
    assertSafeStorageKey('checkpoint_ns', ns, { allowEmpty: true })
    assertSafeStorageKey('checkpoint_id', checkpointId)
    assertSafeStorageKey('task_id', taskId)

    const existingRows = this.db
      .prepare(
        `SELECT task_id, idx FROM langgraph_checkpoint_writes
         WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?`,
      )
      .all(threadId, ns ?? '', checkpointId) as Array<{ task_id: string; idx: number }>
    const existing = new Set(existingRows.map((r) => `${r.task_id},${r.idx}`))

    const prepared = await Promise.all(
      writes.map(async ([channel, value], idx) => {
        const serializedValue = await this.dumpsToString(value)
        const wIdx = WRITES_IDX_MAP[channel] ?? idx
        return { channel, serializedValue, innerKeyStr: `${taskId},${wIdx}` }
      }),
    )

    for (const w of prepared) {
      if (w.innerKeyStr.startsWith(`${taskId},`) && existing.has(w.innerKeyStr)) continue
      this.db
        .prepare(
          `INSERT OR IGNORE INTO langgraph_checkpoint_writes
           (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, value_blob)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(threadId, ns ?? '', checkpointId, taskId, Number(w.innerKeyStr.split(',')[1]), w.channel, w.serializedValue)
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    assertSafeStorageKey('thread_id', threadId)
    this.db.prepare(`DELETE FROM langgraph_checkpoints WHERE thread_id = ?`).run(threadId)
    this.db.prepare(`DELETE FROM langgraph_checkpoint_writes WHERE thread_id = ?`).run(threadId)
  }

  private allThreadIds(): string[] {
    const rows = this.db
      .prepare(`SELECT DISTINCT thread_id FROM langgraph_checkpoints`)
      .all() as Array<{ thread_id: string }>
    return rows.map((r) => r.thread_id)
  }

  private async dumpsToString(obj: unknown): Promise<string> {
    const [, data] = await this.serde.dumpsTyped(obj as never)
    if (typeof data === 'string') return data
    return new TextDecoder().decode(data as Uint8Array)
  }

  private async loadWrites(
    threadId: string,
    ns: string,
    checkpointId: string,
  ): Promise<Array<[string, string, unknown]>> {
    const rows = this.db
      .prepare(
        `SELECT task_id, channel, value_blob FROM langgraph_checkpoint_writes
         WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?`,
      )
      .all(threadId, ns, checkpointId) as unknown as WriteRow[]
    return Promise.all(
      rows.map(
        async (r) =>
          [r.task_id, r.channel, await this.serde.loadsTyped('json', r.value_blob)] as [
            string,
            string,
            unknown,
          ],
      ),
    )
  }
}
