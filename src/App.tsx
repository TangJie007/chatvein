import { useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { backendHealth, backendRequest } from "./api";

type Health = { status: string; service: string; python: string } | null;

export default function App() {
  const [health, setHealth] = useState<Health>(null);
  const [healthError, setHealthError] = useState<string>("");
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState("");
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const logsEnd = useRef<HTMLDivElement>(null);

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
      setHealthError("");
    } catch (e) {
      setHealth(null);
      setHealthError(String(e));
    }
  }

  async function sendChat() {
    if (!message.trim()) return;
    setLoading(true);
    setReply("");
    try {
      const data = await backendRequest<{ reply: string; from: string }>(
        "/api/chat",
        "POST",
        { message }
      );
      setReply(data.reply);
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
            placeholder="输入一些内容发给 Python 后端…"
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
        </div>

        {reply && (
          <div className="reply">
            <strong>后端响应：</strong>
            <pre>{reply}</pre>
          </div>
        )}
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
