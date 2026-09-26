use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter};

// 端口在崩溃重启后可能变化，用原子值而非 OnceLock，保证前端能拿到最新地址。
static BACKEND_PORT: AtomicU16 = AtomicU16::new(8420);
static BACKEND_TOKEN: OnceLock<String> = OnceLock::new();
static BACKEND_CHILD: OnceLock<Mutex<Option<Child>>> = OnceLock::new();
static SHUTTING_DOWN: AtomicBool = AtomicBool::new(false);

/// 正常退出路径之外的最大自动重启次数。
const MAX_AUTO_RESTARTS: u32 = 3;

// ---------------------------------------------------------------------------
// Windows Job Object：KILL_ON_JOB_CLOSE 语义 —— job 句柄被关闭（父进程退出、
// 崩溃、被任务管理器强杀）时，OS 自动收割整个后端进程树，杜绝孤儿进程。
// ---------------------------------------------------------------------------
#[cfg(windows)]
mod job_object {
    use std::mem::size_of;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        SetInformationJobObject,
    };

    pub struct JobHandle(HANDLE);
    // SAFETY: HANDLE 内部即指针，Send/Sync 仅由本模块的锁保护使用。
    unsafe impl Send for JobHandle {}
    unsafe impl Sync for JobHandle {}

    pub fn create_kill_on_close_job() -> Option<JobHandle> {
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() || job == INVALID_HANDLE_VALUE {
                return None;
            }
            // windows-sys 该结构无 Default，按 Windows 惯例清零初始化
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION =
                std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let ok = SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const _,
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            if ok == 0 {
                CloseHandle(job);
                return None;
            }
            Some(JobHandle(job))
        }
    }

    impl JobHandle {
        pub fn assign(&self, process_handle: HANDLE) -> bool {
            unsafe { AssignProcessToJobObject(self.0, process_handle) != 0 }
        }
    }

    impl Drop for JobHandle {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

#[cfg(windows)]
static BACKEND_JOB: OnceLock<Mutex<Option<job_object::JobHandle>>> = OnceLock::new();

pub fn backend_token() -> String {
    BACKEND_TOKEN
        .get()
        .cloned()
        .unwrap_or_else(|| "dev-token".to_string())
}

pub fn backend_port() -> u16 {
    BACKEND_PORT.load(Ordering::SeqCst)
}

pub fn backend_base_url() -> String {
    // 注意：前端 API 客户端拼接 `${base}${endpoint}`，而每个 endpoint 自带 /api 前缀
    // （如 /api/bash/pending），因此这里只返回主机根，绝不能带 /api，否则会变成
    // /api/api/... 的重复前缀导致 404。
    format!("http://127.0.0.1:{}", backend_port())
}

// ---------------------------------------------------------------------------
// 后端进程管理
// ---------------------------------------------------------------------------

/// 启动 Python 后端；启动成功后把子进程登记进 BACKEND_CHILD 并挂 Job Object，
/// 随后开启崩溃监督线程（仅首次启动时开启，重启复用同一监督线程）。
pub fn spawn_backend(app: &AppHandle) {
    spawn_backend_inner(app, true);
}

fn spawn_backend_inner(app: &AppHandle, supervise: bool) {
    let port = find_free_port();
    let token = generate_token();

    #[cfg(windows)]
    let job = job_object::create_kill_on_close_job();
    #[cfg(not(windows))]
    let job: Option<()> = None;

    let Some(child) = spawn_backend_process(port, &token, app) else {
        let _ = app.emit(
            "backend-error",
            "无法启动 Python 后端进程（找不到可用的 Python 运行时）",
        );
        return;
    };
    let _ = app;

    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        if let Some(job) = &job {
            if !job.assign(child.as_raw_handle()) {
                log::warn!(
                    "无法把后端进程加入 Job Object（error={}），回退到手动清理",
                    std::io::Error::last_os_error()
                );
            }
        }
        if let Some(job) = job {
            *BACKEND_JOB.get_or_init(|| Mutex::new(None)).lock().unwrap() = Some(job);
        }
    }

    let _ = BACKEND_CHILD.get_or_init(|| Mutex::new(None)).lock().map(|mut c| {
        *c = Some(child);
    });
    BACKEND_PORT.store(port, Ordering::SeqCst);

    log::info!("Python 后端已启动: port={port} token_len={}", token.len());
    if supervise {
        start_supervisor(app.clone());
    }
}

/// 真正 spawn 子进程的公共逻辑（可被监督线程复用）。
#[cfg(windows)]
fn spawn_backend_process(
    port: u16,
    token: &str,
    app: &AppHandle,
) -> Option<Child> {
    // dev 时用 PATH 里的 python；release 时用与 .exe 同目录的 backend-runtime/backend.exe
    let python_exe = find_python_exe()?;
    let args = backend_args(&python_exe, port);
    let mut command = Command::new(&python_exe);
    command
        .args(&args)
        .env("CHATVEIN_TOKEN", token)
        // 强制 Python 以 UTF-8 输出，避免 Windows 控制台 GBK 导致 Rust 侧日志乱码
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command.spawn().ok()?;
    if let (Some(stdout), Some(stderr)) = (child.stdout.take(), child.stderr.take()) {
        spawn_drain(stdout, app.clone(), "backend-stdout");
        spawn_drain(stderr, app.clone(), "backend-stderr");
    }
    Some(child)
}

#[cfg(not(windows))]
fn spawn_backend_process(
    port: u16,
    token: &str,
    app: &AppHandle,
) -> Option<Child> {
    let python_exe = find_python_exe()?;
    let args = backend_args(&python_exe, port);
    let mut command = Command::new(&python_exe);
    command
        .args(&args)
        .env("CHATVEIN_TOKEN", token)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command.spawn().ok()?;
    if let (Some(stdout), Some(stderr)) = (child.stdout.take(), child.stderr.take()) {
        spawn_drain(stdout, app.clone(), "backend-stdout");
        spawn_drain(stderr, app.clone(), "backend-stderr");
    }
    Some(child)
}

fn backend_args(python_exe: &str, port: u16) -> Vec<String> {
    let exe = std::path::Path::new(python_exe);
    if exe.file_name().is_some_and(|n| n.to_string_lossy().contains("backend")) {
        // release 打包产物：backend-runtime/backend(.exe)；token 走 CHATVEIN_TOKEN 环境变量
        vec![
            "--port".into(),
            port.to_string(),
        ]
    } else {
        // dev 模式：python <repo>/backend/main.py --port（token 走 CHATVEIN_TOKEN）
        // CARGO_MANIFEST_DIR 是 src-tauri，其上级即仓库根；用绝对路径避免依赖 cwd。
        let repo_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap_or_else(|| std::path::Path::new("."));
        vec![
            repo_root.join("backend/main.py").to_string_lossy().to_string(),
            "--port".into(),
            port.to_string(),
        ]
    }
}

#[cfg(windows)]
fn find_python_exe() -> Option<String> {
    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let runtime = exe_dir.join("backend-runtime");
    if runtime.join("backend.exe").exists() {
        return Some(runtime.join("backend.exe").to_string_lossy().to_string());
    }
    // dev 兜底：PATH 里的 python
    Some("python".to_string())
}

#[cfg(not(windows))]
fn find_python_exe() -> Option<String> {
    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let runtime = exe_dir.join("backend-runtime");
    if runtime.join("backend").exists() {
        return Some(runtime.join("backend").to_string_lossy().to_string());
    }
    Some("python3".to_string())
}

/// 崩溃监督线程：try_wait 轮询，异常退出且非应用关闭时自动重启（限次）。
fn start_supervisor(app: AppHandle) {
    std::thread::spawn(move || {
        let mut restarts: u32 = 0;
        loop {
            std::thread::sleep(std::time::Duration::from_millis(1500));
            if SHUTTING_DOWN.load(Ordering::SeqCst) {
                return;
            }

            let exit_code: Option<Option<i32>> = {
                let Ok(mut guard) = BACKEND_CHILD.get().map(|m| m.lock().unwrap()).ok_or(())
                    else {
                    return;
                };
                match guard.as_mut() {
                    Some(child) => match child.try_wait() {
                        Ok(Some(status)) => Some(status.code()),
                        Ok(None) => None,
                        Err(_) => Some(None),
                    },
                    None => return, // 已被 kill_backend() 取走，退出监督
                }
            };

            if exit_code.is_none() {
                continue; // 仍在运行
            }
            if SHUTTING_DOWN.load(Ordering::SeqCst) {
                return;
            }

            if restarts >= MAX_AUTO_RESTARTS {
                log::error!("Python 后端连续异常退出，已停止自动重启（exit={exit_code:?}）");
                let _ = app.emit(
                    "backend-error",
                    format!(
                        "Python 后端连续异常退出 {} 次，已停止自动重启（最后退出码 {exit_code:?}）。\
                         请查看日志后手动重启应用。",
                        MAX_AUTO_RESTARTS
                    ),
                );
                return;
            }

            restarts += 1;
            log::error!(
                "Python 后端异常退出（exit={exit_code:?}），第 {restarts}/{} 次自动重启",
                MAX_AUTO_RESTARTS
            );
            let _ = app.emit(
                "backend-exited",
                format!(
                    "Python 后端异常退出，正在自动重启（{restarts}/{MAX_AUTO_RESTARTS}）"
                ),
            );
            spawn_backend_inner(&app, false);
            // 重启后等待新进程就绪，重新广播 backend-ready，前端自动恢复。
            let handle = app.clone();
            std::thread::spawn(move || {
                if wait_for_backend(
                    backend_port(),
                    std::time::Duration::from_secs(20),
                ) {
                    let _ = handle.emit("backend-ready", backend_base_url());
                } else {
                    let _ = handle.emit(
                        "backend-error",
                        "Python 后端重启后仍未就绪，请查看日志或重启应用",
                    );
                }
            });
        }
    });
}

/// 结束后端进程。设置 SHUTTING_DOWN 防止监督线程重启；
/// Windows 上 Job Object 句柄随进程退出由 OS 关闭，兜底收割整个进程树。
pub fn kill_backend() {
    SHUTTING_DOWN.store(true, Ordering::SeqCst);
    if let Some(lock) = BACKEND_CHILD.get() {
        if let Ok(mut guard) = lock.lock() {
            if let Some(mut child) = guard.take() {
                log::info!("正在结束 Python 后端进程…");
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

/// 等待后端 HTTP 就绪（探测 /api/health 返回 200 + status=ok），超时返回 false。
pub fn wait_for_backend(port: u16, timeout: std::time::Duration) -> bool {
    let start = std::time::Instant::now();
    loop {
        if http_health_ok(port) {
            return true;
        }
        if start.elapsed() > timeout {
            return false;
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    }
}

fn http_health_ok(port: u16) -> bool {
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::time::Duration;

    let Ok(mut stream) = TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
        Duration::from_millis(800),
    ) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(800)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(800)));

    let req = format!(
        "GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
    );
    if stream.write_all(req.as_bytes()).is_err() {
        return false;
    }

    let mut buf = [0u8; 512];
    let mut text = String::new();
    loop {
        match stream.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                text.push_str(&String::from_utf8_lossy(&buf[..n]));
                if text.len() > 2048 {
                    break;
                }
            }
            Err(_) => break,
        }
    }
    let status_line = text.lines().next().unwrap_or("");
    status_line.contains(" 200") && text.contains("\"status\":\"ok\"")
}

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

fn spawn_drain<R: Read + Send + 'static>(reader: R, app: AppHandle, event: &'static str) {
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 1024];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let text = String::from_utf8_lossy(&buf[..n]).to_string();
                    // 同时落盘（tauri-plugin-log 的 LogDir target）与上抛给前端
                    if event == "backend-stderr" {
                        log::warn!("[backend-stderr] {}", text.trim_end());
                    } else {
                        log::info!("[backend] {}", text.trim_end());
                    }
                    let _ = app.emit(event, text);
                }
                Err(_) => break,
            }
        }
    });
}

fn generate_token() -> String {
    use rand::Rng;
    let mut bytes = [0u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn find_free_port() -> u16 {
    use std::net::TcpListener;
    TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map(|addr| addr.port())
        .unwrap_or(8420)
}

/// dev 模式释放 8420 端口：只杀 ChatVein 自家残留后端，避免误伤其他服务。
#[cfg(debug_assertions)]
pub fn free_dev_backend_port() {
    let port = backend_port();
    let script = format!(
        r#"
$ErrorActionPreference = 'SilentlyContinue'
$conns = Get-NetTCPConnection -LocalPort {port} -State Listen | Select-Object -ExpandProperty OwningProcess -Unique
foreach ($procId in $conns) {{
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$procId"
  if ($null -ne $p -and ($p.CommandLine -match 'chatvein' -or $p.CommandLine -match 'backend/main\.py' -or $p.CommandLine -match 'backend\.exe')) {{
    Stop-Process -Id $procId -Force
  }}
}}
"#
    );
    let _ = std::process::Command::new("powershell")
        .args(["-NoProfile", "-Command", &script])
        .spawn()
        .and_then(|mut c| c.wait());
}
