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

/// Per-run random token that authorizes frontend → backend requests.
///
/// Generated once at process start, handed to the Python backend via the
/// `CHATVEIN_TOKEN` env var, and exposed to the React UI through the
/// `backend_token` command. The backend rejects any request whose
/// `X-ChatVein-Token` header does not match.
static BACKEND_TOKEN: OnceLock<String> = OnceLock::new();

/// The shared access token for this app run (never persisted).
pub fn backend_token() -> String {
    BACKEND_TOKEN.get_or_init(|| {
        use rand::RngExt;
        let mut bytes = [0u8; 32];
        rand::rng().fill(&mut bytes);
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    })
    .clone()
}

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

/// Dev 固定端口时：先清掉残留的旧 Python，避免新路由（如 /api/skills）仍 404。
#[cfg(debug_assertions)]
fn free_dev_backend_port(port: u16) {
    kill_backend();
    #[cfg(windows)]
    {
        let _ = Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                &format!(
                    "$c = Get-NetTCPConnection -LocalPort {port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; if ($c) {{ $c | ForEach-Object {{ Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }} }}"
                ),
            ])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("sh")
            .args([
                "-c",
                &format!("fuser -k {port}/tcp 2>/dev/null || true"),
            ])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    std::thread::sleep(std::time::Duration::from_millis(200));
}

/// Spawn the Python backend next to the app and forward its output to the UI.
pub fn spawn_backend(app: &AppHandle) {
    let resource_dir = match app.path().resource_dir() {
        Ok(d) => d,
        Err(e) => {
            emit_error(app, &format!("无法获取资源目录: {e}"));
            return;
        }
    };

    // Release: PyInstaller onedir at <resources>/backend-runtime/backend(.exe)
    // Dev:     <repo>/backend/main.py via .venv / PATH python.
    // A stale backend.exe left in target/debug must not win in dev, or new
    // routes such as /api/mcps/catalog stay 404 until the runtime is rebuilt.
    let frozen = if cfg!(debug_assertions) {
        None
    } else {
        frozen_backend_exe(&resource_dir)
    };
    let (program, args, cwd, fallback_dir) = if let Some(exe) = frozen {
        let cwd = exe
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| resource_dir.join("backend-runtime"));
        (exe, Vec::<String>::new(), cwd.clone(), cwd)
    } else {
        // Dev resource dir is `src-tauri/target/debug`. A leftover `backend/`
        // copy there must not shadow the repo source, or the UI keeps calling
        // routes that only exist in `backend/main.py` (404).
        let backend_dir = if cfg!(debug_assertions) {
            let dev = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../backend");
            if dev.join("main.py").exists() {
                dev.canonicalize().unwrap_or(dev)
            } else {
                resource_dir.join("backend")
            }
        } else {
            let bundled = resource_dir.join("backend");
            if bundled.join("main.py").exists() {
                bundled
            } else {
                let dev = resource_dir.join("../backend");
                dev.canonicalize().unwrap_or(dev)
            }
        };
        let main_py = backend_dir.join("main.py");
        if !main_py.exists() {
            emit_error(
                app,
                &format!(
                    "未找到后端（已尝试打包产物 backend-runtime 与源码入口 {}）",
                    main_py.display()
                ),
            );
            return;
        }
        let python = match find_python(&backend_dir) {
            Some(p) => p,
            None => {
                emit_error(
                    app,
                    "未找到 Python 解释器（已尝试仓库根 .venv 以及 python / python3）",
                );
                return;
            }
        };
        (
            python,
            vec![main_py.to_string_lossy().into_owned()],
            backend_dir.clone(),
            backend_dir,
        )
    };

    // Own the storage location here (message layer decides paths): the packaged
    // backend lives in a read-only resources dir, so the SQLite database must
    // go to the per-user app data dir instead.
    let data_dir = resolve_data_dir(app, &fallback_dir);
    if let Err(e) = std::fs::create_dir_all(&data_dir) {
        emit_error(app, &format!("无法创建数据目录 {}: {e}", data_dir.display()));
    }

    let port = backend_port();
    #[cfg(debug_assertions)]
    free_dev_backend_port(port);

    let mut cmd = Command::new(&program);
    for arg in &args {
        cmd.arg(arg);
    }
    cmd.env("CHATVEIN_RESOURCE_DIR", &resource_dir);
    // 访问令牌：后端校验每个请求的 X-ChatVein-Token，非本应用启动的请求一律拒绝。
    cmd.env("CHATVEIN_TOKEN", backend_token());
    // Dev: uvicorn --reload so edits under backend/*.py pick up without
    // restarting `tauri dev`. Release / frozen builds never set this.
    #[cfg(debug_assertions)]
    cmd.env("CHATVEIN_RELOAD", "1");
    let mut child = match cmd
        .arg("--port")
        .arg(port.to_string())
        .current_dir(&cwd)
        .env("CHATVEIN_PORT", port.to_string())
        .env("CHATVEIN_DATA_DIR", &data_dir)
        .env("PYTHONUNBUFFERED", "1")
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

/// PyInstaller onedir entry shipped via `bundle.resources` as `backend-runtime`.
fn frozen_backend_exe(resource_dir: &std::path::Path) -> Option<std::path::PathBuf> {
    let exe = if cfg!(windows) {
        resource_dir.join("backend-runtime").join("backend.exe")
    } else {
        resource_dir.join("backend-runtime").join("backend")
    };
    exe.exists().then_some(exe)
}

/// Locate a usable Python interpreter for **dev** (source) runs, in priority order:
///   1. repo-root `.venv`
///   2. `python` / `python3` on PATH
fn find_python(backend_dir: &std::path::Path) -> Option<std::path::PathBuf> {
    // The dev virtualenv lives at the repo root, deliberately outside `backend/`
    // so local caches and a several-hundred-MB venv never get mixed into source.
    let repo_root = backend_dir.parent()?;
    let venv = if cfg!(windows) {
        repo_root.join(".venv").join("Scripts").join("python.exe")
    } else {
        repo_root.join(".venv").join("bin").join("python")
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
/// Rust owns path selection: the packaged backend sits inside the read-only
/// resources directory, so the database must live in the per-user app data
/// directory instead. If that cannot be resolved we fall back to
/// `<backend-or-runtime>/data` so the app still starts (dev / unusual sandboxing).
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
