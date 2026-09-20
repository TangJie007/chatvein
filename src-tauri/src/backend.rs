use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Manager};

/// Chosen backend port, resolved once and reused by the spawner, the readiness
/// probe and the proxy commands so they always agree.
///
/// - Dev builds (`tauri dev`, debug): a fixed, predictable port `8420`.
/// - Release builds (`tauri build`): a dynamically picked free port >= `3000`.
static BACKEND_PORT: OnceLock<u16> = OnceLock::new();

/// Resolve the backend port. Computed lazily on first use and cached.
pub fn backend_port() -> u16 {
    *BACKEND_PORT.get_or_init(|| {
        if cfg!(debug_assertions) {
            8420
        } else {
            find_free_port(3000)
        }
    })
}

/// Base URL of the embedded Python backend.
pub fn backend_base_url() -> String {
    format!("http://127.0.0.1:{}", backend_port())
}

/// Find an available TCP port >= `start` on the loopback interface.
/// The listener is dropped immediately so the port is free for the backend.
fn find_free_port(start: u16) -> u16 {
    for port in start..=65535 {
        if std::net::TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return port;
        }
    }
    8420 // extremely unlikely fallback
}

/// Global handle to the spawned Python process so we can terminate it on exit.
static BACKEND_CHILD: OnceLock<Mutex<Option<Child>>> = OnceLock::new();

/// Spawn the Python backend next to the app and forward its output to the UI.
pub fn spawn_backend(app: &AppHandle) {
    let resource_dir = match app.path().resource_dir() {
        Ok(d) => d,
        Err(e) => {
            emit_error(app, &format!("无法获取资源目录: {e}"));
            return;
        }
    };

    // Bundled layout: <resources>/backend/main.py
    // Dev layout:      <src-tauri>/../backend/main.py
    let bundled_backend = resource_dir.join("backend");
    let backend_dir = if bundled_backend.join("main.py").exists() {
        bundled_backend
    } else {
        let dev = resource_dir.join("../backend");
        dev.canonicalize().unwrap_or(dev)
    };
    let main_py = backend_dir.join("main.py");

    if !main_py.exists() {
        emit_error(app, &format!("未找到后端入口: {}", main_py.display()));
        return;
    }

    let python = match find_python(&backend_dir, &resource_dir) {
        Some(p) => p,
        None => {
            emit_error(
                app,
                "未找到 Python 解释器（已尝试打包运行时、backend/.venv 以及 python / python3）",
            );
            return;
        }
    };

    // Own the storage location here (message layer decides paths): the bundled
    // `backend/` lives in a read-only resources dir, so the SQLite database
    // must go to the per-user app data dir instead.
    let data_dir = resolve_data_dir(app, &backend_dir);
    if let Err(e) = std::fs::create_dir_all(&data_dir) {
        emit_error(app, &format!("无法创建数据目录 {}: {e}", data_dir.display()));
    }

    let port = backend_port();
    let mut child = match Command::new(&python)
        .arg(&main_py)
        .arg("--port")
        .arg(port.to_string())
        .current_dir(&backend_dir)
        .env("CHATVEIN_PORT", port.to_string())
        .env("CHATVEIN_DATA_DIR", &data_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            emit_error(app, &format!("启动 Python 后端失败: {e}"));
            return;
        }
    };

    // Forward stdout/stderr to the UI as events so the message layer is observable.
    if let Some(out) = child.stdout.take() {
        spawn_drain(out, app.clone(), "backend-stdout");
    }
    if let Some(err) = child.stderr.take() {
        spawn_drain(err, app.clone(), "backend-stderr");
    }

    BACKEND_CHILD
        .get_or_init(|| Mutex::new(None))
        .lock()
        .unwrap()
        .replace(child);
}

/// Block until the backend accepts TCP connections, or time out.
pub fn wait_for_backend(port: u16, timeout: std::time::Duration) -> bool {
    let start = std::time::Instant::now();
    loop {
        if std::net::TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return true;
        }
        if start.elapsed() > timeout {
            return false;
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    }
}

/// Terminate the embedded Python backend if it is still running.
pub fn kill_backend() {
    if let Some(lock) = BACKEND_CHILD.get() {
        if let Ok(mut guard) = lock.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

/// Locate a usable Python interpreter, in priority order:
///   1. bundled standalone runtime (shipped via `bundle.resources` as `python-runtime`)
///   2. dev virtualenv at `backend/.venv`
///   3. `python` / `python3` found on PATH
fn find_python(backend_dir: &std::path::Path, resource_dir: &std::path::Path) -> Option<std::path::PathBuf> {
    let runtime = if cfg!(windows) {
        resource_dir.join("python-runtime").join("python.exe")
    } else {
        resource_dir.join("python-runtime").join("bin").join("python")
    };
    if runtime.exists() {
        return Some(runtime);
    }

    let venv = if cfg!(windows) {
        backend_dir.join(".venv").join("Scripts").join("python.exe")
    } else {
        backend_dir.join(".venv").join("bin").join("python")
    };
    if venv.exists() {
        return Some(venv);
    }

    for name in ["python", "python3"] {
        if Command::new(name)
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
        {
            return Some(std::path::PathBuf::from(name));
        }
    }
    None
}

/// Directory handed to the Python backend for its SQLite database (and any
/// other persistent state) via `CHATVEIN_DATA_DIR`.
///
/// Rust owns path selection: the packaged `backend/` sits inside the read-only
/// resources directory, so the database must live in the per-user app data
/// directory instead. If that cannot be resolved we fall back to
/// `<backend>/data` so the app still starts (dev / unusual sandboxing).
fn resolve_data_dir(app: &AppHandle, backend_dir: &std::path::Path) -> std::path::PathBuf {
    match app.path().app_data_dir() {
        Ok(dir) => dir,
        Err(e) => {
            emit_error(app, &format!("无法获取应用数据目录，回退到后端目录: {e}"));
            backend_dir.join("data")
        }
    }
}

/// Spawn a thread that reads a pipe to completion and emits each chunk.
fn spawn_drain<R: Read + Send + 'static>(reader: R, app: AppHandle, event: &'static str) {
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 1024];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let text = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app.emit(event, text);
                }
                Err(_) => break,
            }
        }
    });
}

fn emit_error(app: &AppHandle, msg: &str) {
    let _ = app.emit("backend-error", msg.to_string());
}
