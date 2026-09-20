import { useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  backendHealth,
  backendRequest,
  clearHistory,
  dbInfo as fetchDbInfo,
  deleteConversation,
  getConversation,
  listConversations,
  type ChatMessageRecord,
  type ConversationRecord,
  type DbInfo,
} from "./api";

type Health = {
  status: string;
  service: string;
  python: string;
  db: DbInfo;
} | null;

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export default function App() {
  const [health, setHealth] = useState<Health>(null);
  const [healthError, setHealthError] = useState<string>("");
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState("");
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const logsEnd = useRef<HTMLDivElement>(null);

  // Persisted state, backed by the Python side's SQLite database.
  const [dbInfo, setDbInfo] = useState<DbInfo | null>(null);
  const [conversations, setConversations] = useState<ConversationRecord[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageRecord[]>([]);
  const [historyError, setHistoryError] = useState("");

  // Health check + subscribe to backend lifecycle / log events from Rust.
  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];
    let alive = true;

    const setup = async () => {
      unlisteners.push(
        await listen<string>("backend-ready", () => {
          if (alive) void refreshHealth();
        })
      );
      unlisteners.push(
        await listen<string>("backend-error", (e) => {
          if (alive) setHealthError(e.payload);
        })
      );
      unlisteners.push(
        await listen<string>("backend-stdout", (e) => {
          if (alive) pushLog(`[py] ${e.payload.trim()}`);
        })
      );
      unlisteners.push(
        await listen<string>("backend-stderr", (e) => {
          if (alive) pushLog(`[py!] ${e.payload.trim()}`);
        })
      );
      await refreshHealth();
      await refreshHistory();
    };

    const pushLog = (line: string) =>
      setLogs((prev) => [...prev.slice(-200), line]);

    void setup();
    const timer = setInterval(() => void refreshHealth(), 5000);

    return () => {
      alive = false;
      clearInterval(timer);
      unlisteners.forEach((u) => u());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    logsEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  async function refreshHealth() {
    try {
      const h = await backendHealth();
      setHealth(h);
      setDbInfo(h.db);
      setHealthError("");
    } catch (e) {
      setHealth(null);
      setHealthError(String(e));
    }
  }

  /** Load a conversation's persisted messages into the view. */
  async function openConversation(conversationId: string) {
    try {
      const data = await getConversation(conversationId);
      setActiveId(conversationId);
      setMessages(data.messages);
      setHistoryError("");
    } catch (e) {
      setHistoryError(String(e));
    }
  }

  /** Reload conversation list + db stats, keeping (or focusing) a conversation. */
  async function refreshHistory(preferId?: string | null) {
    try {
      const [list, info] = await Promise.all([listConversations(), fetchDbInfo()]);
      setConversations(list);
      setDbInfo(info);
      setHistoryError("");

      const target =
        preferId ??
        (list.some((c) => c.id === activeId) ? activeId : list[0]?.id ?? null);
      if (target) {
        await openConversation(target);
      } else {
        setActiveId(null);
        setMessages([]);
      }
    } catch (e) {
      setHistoryError(String(e));
    }
  }

  async function sendChat() {
    if (!message.trim()) return;
    setLoading(true);
    setReply("");
    try {
      const data = await backendRequest<{ reply: string; conversation_id: string }>(
        "/api/chat",
        "POST",
        { message, conversation_id: activeId }
      );
      setReply(data.reply);
      setMessage("");
      // The exchange is now in SQLite — reload so the list reflects it.
      await refreshHistory(data.conversation_id);
    } catch (e) {
      setReply(`Error: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  async function sendEcho() {
    setLoading(true);
    try {
      const data = await backendRequest<{ echo: string; length: number }>(
        "/api/echo",
        "POST",
        { message }
      );
      setReply(`echo(${data.length}): ${data.echo}`);
    } catch (e) {
      setReply(`Error: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  async function sendHello() {
    setLoading(true);
    setReply("");
    try {
      const data = await backendRequest<{ message: string; from: string }>(
        "/api/hello"
      );
      setReply(`${data.message}（来自 ${data.from}）`);
    } catch (e) {
      setReply(`Error: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  async function onDeleteConversation(conversationId: string) {
    try {
      await deleteConversation(conversationId);
      await refreshHistory(activeId === conversationId ? null : activeId);
    } catch (e) {
      setHistoryError(String(e));
    }
  }

  async function onClearHistory() {
    if (!window.confirm("确定要清空 SQLite 中的全部会话与消息吗？此操作不可撤销。")) {
      return;
    }
    try {
      await clearHistory();
      setReply("");
      await refreshHistory(null);
    } catch (e) {
      setHistoryError(String(e));
    }
  }

  const connected = !!health && health.status === "ok";

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>ChatVein</h1>
          <p className="subtitle">React · Rust (消息层) · Python (后端)</p>
        </div>
        <span className={`badge ${connected ? "ok" : "bad"}`}>
          {healthError
            ? "后端未连接"
            : connected
            ? `已连接 · Python ${health?.python ?? ""}`
            : "连接中…"}
        </span>
      </header>

      <section className="panel">
        <label className="field">
          <span>消息</span>
          <input
            value={message}
            placeholder={
              activeId ? "继续发送到当前会话…" : "输入一些内容，将开启一个新会话…"
            }
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendChat()}
          />
        </label>

        <div className="actions">
          <button onClick={sendChat} disabled={loading || !connected}>
            发送到 /api/chat
          </button>
          <button onClick={sendEcho} disabled={loading || !connected}>
            发送到 /api/echo
          </button>
          <button onClick={sendHello} disabled={loading || !connected}>
            调用 /api/hello
          </button>
        </div>

        {reply && (
          <div className="reply">
            <strong>后端响应：</strong>
            <pre>{reply}</pre>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="logs-head">
          <span>
            会话历史（SQLite 持久化）
            {dbInfo && (
              <span className="muted">
                {" "}
                · {dbInfo.conversations} 会话 / {dbInfo.messages} 消息
              </span>
            )}
          </span>
          <span className="head-actions">
            <button className="link" onClick={() => void refreshHistory()}>
              刷新
            </button>
            <button className="link" onClick={onClearHistory}>
              清空
            </button>
          </span>
        </div>

        {dbInfo && (
          <p className="db-path" title={dbInfo.path}>
            <code>{dbInfo.path}</code>
            <span className="muted"> · schema v{dbInfo.schema_version}</span>
          </p>
        )}

        {historyError && <p className="muted">历史读取失败：{historyError}</p>}

        <div className="history">
          <div className="conv-list">
            <button
              className={`conv-new ${activeId === null ? "active" : ""}`}
              onClick={() => {
                setActiveId(null);
                setMessages([]);
              }}
            >
              + 新会话
            </button>
            {conversations.length === 0 ? (
              <p className="muted">暂无会话</p>
            ) : (
              conversations.map((c) => (
                <div
                  key={c.id}
                  className={`conv-item ${activeId === c.id ? "active" : ""}`}
                >
                  <button className="conv-main" onClick={() => void openConversation(c.id)}>
                    <span className="conv-title">{c.title || "未命名会话"}</span>
                    <span className="conv-meta">
                      {c.message_count} 条 · {formatTime(c.updated_at)}
                    </span>
                    {c.last_message && (
                      <span className="conv-preview">{c.last_message}</span>
                    )}
                  </button>
                  <button
                    className="link conv-del"
                    title="删除该会话"
                    onClick={() => void onDeleteConversation(c.id)}
                  >
                    删除
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="msg-list">
            <div className="msg-list-head">
              {activeId ? (
                <span className="muted">当前会话 {activeId.slice(0, 8)}…</span>
              ) : (
                <span className="muted">新会话（发送后写入 SQLite）</span>
              )}
            </div>
            {messages.length === 0 ? (
              <p className="muted">暂无可显示的消息</p>
            ) : (
              messages.map((m) => (
                <div key={m.id} className={`msg ${m.role}`}>
                  <div className="msg-head">
                    <span className={`role ${m.role}`}>{m.role}</span>
                    <span className="muted">{formatTime(m.created_at)}</span>
                  </div>
                  <div className="msg-body">{m.content}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="panel logs">
        <div className="logs-head">
          <span>后端日志（来自 Rust 消息层转发的 Python stdout/stderr）</span>
          <button className="link" onClick={() => setLogs([])}>
            清空
          </button>
        </div>
        <div className="logs-body">
          {logs.length === 0 ? (
            <p className="muted">暂无日志</p>
          ) : (
            logs.map((l, i) => (
              <div key={i} className="log-line">
                {l}
              </div>
            ))
          )}
          <div ref={logsEnd} />
        </div>
      </section>
    </div>
  );
}
