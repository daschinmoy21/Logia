//! Versioned local IPC transport. No webview or TCP dependency.
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::{
    future::Future,
    path::{Path, PathBuf},
    pin::Pin,
    sync::Arc,
    time::Duration,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader},
    sync::{Notify, Semaphore},
};

const MAX_REQUEST: u64 = 2 * 1024 * 1024;
const MAX_RESPONSE: usize = 32 * 1024 * 1024;
pub const COMMANDS: &[&str] = &[
    "status",
    "active",
    "files",
    "list",
    "folders",
    "search",
    "read",
    "links",
    "backlinks",
    "tags",
    "open",
    "create",
    "append",
    "prepend",
    "write",
    "rename",
    "save",
    "daily",
    "daily:read",
    "daily:append",
];
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub version: u32,
    pub command: String,
    #[serde(default)]
    pub params: Map<String, Value>,
}
pub type Handler =
    Arc<dyn Fn(Request) -> Pin<Box<dyn Future<Output = Value> + Send>> + Send + Sync>;
pub fn error(code: &str, message: &str) -> Value {
    json!({"schemaVersion":1,"error":{"code":code,"message":message}})
}

pub fn endpoint() -> PathBuf {
    if let Some(path) = std::env::var_os("LOGIA_CLI_SOCKET") {
        return PathBuf::from(path);
    }
    #[cfg(unix)]
    {
        PathBuf::from(format!("/tmp/logia-cli-{}/cli.sock", unsafe {
            libc::geteuid()
        }))
    }
    #[cfg(windows)]
    {
        let user = std::env::var("USERNAME")
            .unwrap_or_else(|_| "user".into())
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                    c
                } else {
                    '_'
                }
            })
            .collect::<String>();
        PathBuf::from(format!(r"\\.\pipe\logia-cli-{user}"))
    }
}

pub async fn exchange<S: AsyncRead + AsyncWrite + Unpin>(
    mut stream: S,
    handler: Handler,
    timeout: Duration,
) {
    let result = tokio::time::timeout(timeout, async {
        let mut bytes = Vec::new();
        let read = BufReader::new((&mut stream).take(MAX_REQUEST))
            .read_until(b'\n', &mut bytes)
            .await;
        if read.is_err() || bytes.last() != Some(&b'\n') {
            return error("INVALID_REQUEST", "Expected a JSON line smaller than 2 MiB");
        }
        let request: Request = match serde_json::from_slice(&bytes) {
            Ok(value) => value,
            Err(_) => return error("INVALID_REQUEST", "Malformed CLI request"),
        };
        if request.version != 1
            || !COMMANDS.contains(&request.command.as_str())
            || request.params.len() > 32
            || request
                .params
                .values()
                .any(|value| !value.is_string() && !value.is_boolean())
        {
            return error(
                "INVALID_REQUEST",
                "Unsupported protocol, command, or parameter shape",
            );
        }
        handler(request).await
    })
    .await
    .unwrap_or_else(|_| {
        error(
            "TIMEOUT",
            "GUI request timed out. An edit may have applied; read before retrying.",
        )
    });
    let mut bytes = serde_json::to_vec(&result).unwrap_or_default();
    if bytes.len() > MAX_RESPONSE {
        bytes =
            serde_json::to_vec(&error("RESPONSE_TOO_LARGE", "Response exceeds 32 MiB")).unwrap();
    }
    bytes.push(b'\n');
    let _ = tokio::time::timeout(Duration::from_secs(5), stream.write_all(&bytes)).await;
}

#[cfg(unix)]
fn private_parent(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::{DirBuilderExt, MetadataExt, PermissionsExt};
    if !path.is_absolute() {
        return Err("LOGIA_CLI_SOCKET must be an absolute path".into());
    }
    let parent = path.parent().ok_or("Missing IPC parent directory")?;
    // Only create this dedicated directory; never chmod an arbitrary user-supplied parent.
    if parent == Path::new(&format!("/tmp/logia-cli-{}", unsafe { libc::geteuid() })) {
        match std::fs::DirBuilder::new().mode(0o700).create(parent) {
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(e) => return Err(e.to_string()),
        }
        let meta = std::fs::symlink_metadata(parent).map_err(|e| e.to_string())?;
        if !meta.is_dir()
            || meta.file_type().is_symlink()
            || meta.uid() != unsafe { libc::geteuid() }
        {
            return Err("Unsafe CLI runtime directory".into());
        }
        std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(unix)]
pub async fn serve(path: PathBuf, handler: Handler, stop: Arc<Notify>) -> Result<(), String> {
    use std::os::unix::fs::{FileTypeExt, MetadataExt, PermissionsExt};
    use tokio::net::{UnixListener, UnixStream};
    private_parent(&path)?;
    use fs2::FileExt;
    use std::os::unix::fs::OpenOptionsExt;
    let lock_path = path.with_extension("lock");
    let lock = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(lock_path)
        .map_err(|e| e.to_string())?;
    if lock.metadata().map_err(|e| e.to_string())?.uid() != unsafe { libc::geteuid() } {
        return Err("Unsafe CLI endpoint lock".into());
    }
    lock.try_lock_exclusive()
        .map_err(|_| "Another Logia GUI owns this CLI endpoint")?;
    if let Ok(meta) = std::fs::symlink_metadata(&path) {
        if !meta.file_type().is_socket() || meta.uid() != unsafe { libc::geteuid() } {
            return Err("Refusing to replace an unsafe IPC path".into());
        }
        match UnixStream::connect(&path).await {
            Ok(_) => return Err("Another Logia GUI already owns the CLI endpoint".into()),
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::ConnectionRefused | std::io::ErrorKind::NotFound
                ) => {}
            Err(error) => return Err(format!("Cannot inspect existing CLI endpoint: {error}")),
        }
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    let listener = UnixListener::bind(&path).map_err(|e| e.to_string())?;
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))
        .map_err(|e| e.to_string())?;
    let own_inode = std::fs::metadata(&path).map_err(|e| e.to_string())?.ino();
    let limit = Arc::new(Semaphore::new(8));
    loop {
        let accepted =
            tokio::select! { _ = stop.notified() => break, value = listener.accept() => value };
        let (stream, _) = accepted.map_err(|e| e.to_string())?;
        if stream
            .peer_cred()
            .map(|c| c.uid() != unsafe { libc::geteuid() })
            .unwrap_or(true)
        {
            continue;
        }
        let permit = limit.clone().try_acquire_owned();
        let callback = handler.clone();
        tokio::spawn(async move {
            match permit {
                Ok(_permit) => exchange(stream, callback, Duration::from_secs(30)).await,
                Err(_) => {
                    exchange(
                        stream,
                        Arc::new(|_| {
                            Box::pin(async { error("BUSY", "Too many pending CLI requests") })
                        }),
                        Duration::from_secs(1),
                    )
                    .await
                }
            }
        });
    }
    drop(listener);
    // Do not unlink a replacement endpoint created by somebody else.
    if std::fs::symlink_metadata(&path)
        .map(|m| m.ino() == own_inode && m.uid() == unsafe { libc::geteuid() })
        .unwrap_or(false)
    {
        let _ = std::fs::remove_file(path);
    }
    Ok(())
}

#[cfg(windows)]
pub async fn serve(path: PathBuf, handler: Handler, stop: Arc<Notify>) -> Result<(), String> {
    use tokio::net::windows::named_pipe::ServerOptions;
    let mut server = ServerOptions::new()
        .first_pipe_instance(true)
        .reject_remote_clients(true)
        .create(&path)
        .map_err(|e| e.to_string())?;
    let limit = Arc::new(Semaphore::new(8));
    loop {
        tokio::select! { _ = stop.notified() => break, value = server.connect() => value.map_err(|e| e.to_string())? };
        let connected = server;
        server = ServerOptions::new()
            .reject_remote_clients(true)
            .create(&path)
            .map_err(|e| e.to_string())?;
        let callback = handler.clone();
        let permit = limit.clone().try_acquire_owned();
        tokio::spawn(async move {
            if let Ok(_permit) = permit {
                exchange(connected, callback, Duration::from_secs(30)).await;
            }
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    async fn roundtrip(input: &[u8], handler: Handler, deadline: Duration) -> Value {
        let (mut client, server) = tokio::io::duplex(3 * 1024 * 1024);
        let task = tokio::spawn(exchange(server, handler, deadline));
        client.write_all(input).await.unwrap();
        client.shutdown().await.unwrap();
        let mut reply = String::new();
        client.read_to_string(&mut reply).await.unwrap();
        task.await.unwrap();
        serde_json::from_str(&reply).unwrap()
    }
    #[tokio::test]
    async fn dispatches_and_rejects_invalid_frames() {
        let handler: Handler =
            Arc::new(|r| Box::pin(async move { json!({"schemaVersion":1,"data":r.command}) }));
        let reply = roundtrip(
            b"{\"version\":1,\"command\":\"read\",\"params\":{}}\n",
            handler.clone(),
            Duration::from_secs(1),
        )
        .await;
        assert_eq!(reply["data"], "read");
        for input in [
            b"not json\n".as_slice(),
            b"{\"version\":2,\"command\":\"read\"}\n",
            b"{\"version\":1,\"command\":\"eval\"}\n",
            b"{\"version\":1,\"command\":\"read\",\"params\":{\"id\":[]}}\n",
            b"{}",
        ] {
            assert_eq!(
                roundtrip(input, handler.clone(), Duration::from_secs(1)).await["error"]["code"],
                "INVALID_REQUEST"
            );
        }
    }
    #[tokio::test]
    async fn unresponsive_handler_times_out() {
        let handler: Handler = Arc::new(|_| Box::pin(async { std::future::pending().await }));
        assert_eq!(
            roundtrip(
                b"{\"version\":1,\"command\":\"read\"}\n",
                handler,
                Duration::from_millis(20)
            )
            .await["error"]["code"],
            "TIMEOUT"
        );
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn actual_socket_is_private_and_live_endpoint_is_not_replaced() {
        use std::os::unix::fs::PermissionsExt;
        use tokio::net::UnixStream;
        let path = PathBuf::from(format!(
            "/tmp/logia-cli-test-{}-{}.sock",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let stop = Arc::new(Notify::new());
        let handler: Handler =
            Arc::new(|_| Box::pin(async { json!({"schemaVersion":1,"data":"live"}) }));
        let task = tokio::spawn(serve(path.clone(), handler.clone(), stop.clone()));
        for _ in 0..100 {
            if path.exists() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        let mut client = UnixStream::connect(&path).await.unwrap();
        client
            .write_all(b"{\"version\":1,\"command\":\"status\"}\n")
            .await
            .unwrap();
        client.shutdown().await.unwrap();
        let mut result = String::new();
        client.read_to_string(&mut result).await.unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&result).unwrap()["data"],
            "live"
        );
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert!(serve(path.clone(), handler, Arc::new(Notify::new()))
            .await
            .is_err());
        stop.notify_one();
        task.await.unwrap().unwrap();
        assert!(!path.exists());
        let _ = std::fs::remove_file(path.with_extension("lock"));
    }
}
