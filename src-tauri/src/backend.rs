use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Manager};

/// Port the Python backend listens on (loopback only).
pub const BACKEND_PORT: u16 = 18793;

/// Base URL of the embedded Python backend.
pub fn backend_base_url() -> String {
    format!("http://127.0.0.1:{}", BACKEND_PORT)
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

    let mut child = match Command::new(&python)
        .arg(&main_py)
        .arg("--port")
        .arg(BACKEND_PORT.to_string())
        .current_dir(&backend_dir)
        .env("CHATVEIN_PORT", BACKEND_PORT.to_string())
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
