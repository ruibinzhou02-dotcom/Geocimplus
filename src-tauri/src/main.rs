#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::{sync::Mutex, process::{Command, Child}, time::Duration, net::TcpStream};
use tauri::{Manager, WebviewWindowBuilder, WebviewUrl};
#[cfg(windows)] use std::os::windows::process::CommandExt;
struct Backend(Mutex<Option<Child>>);
fn main() {
    tauri::Builder::default()
        .manage(Backend(Mutex::new(None)))
        .setup(|app| {
            let project = std::env::var("GEOCIM_PROJECT").map_err(|_| "Set GEOCIM_PROJECT to the audited local workspace before launching")?;
            if !std::path::Path::new(&project).join("config/data_catalog.json").exists() { return Err("Local data catalog is missing".into()); }
            if TcpStream::connect_timeout(&"127.0.0.1:8765".parse()?, Duration::from_millis(200)).is_ok() { return Err("Port 8765 is already occupied. Stop the browser backend before starting the desktop app.".into()); }
            let resources=app.path().resource_dir()?;
            let mut command=Command::new(resources.join("bin/geocim-backend.exe"));
            command.args(["--project",&project,"--frontend"]).arg(resources.join("frontend")).args(["--port","8765"]);
            #[cfg(windows)] command.creation_flags(0x08000000);
            let mut child=command.spawn()?;
            let mut ready=false;
            for _ in 0..100 {
                if child.try_wait()?.is_some() { return Err("GeoCIM backend exited before startup".into()); }
                if TcpStream::connect_timeout(&"127.0.0.1:8765".parse()?,Duration::from_millis(100)).is_ok() { ready=true;break; }
                std::thread::sleep(Duration::from_millis(200));
            }
            if !ready { let _=child.kill(); return Err("GeoCIM backend startup timed out".into()); }
            *app.state::<Backend>().0.lock().unwrap()=Some(child);
            WebviewWindowBuilder::new(app,"main",WebviewUrl::External("http://127.0.0.1:8765/".parse()?)).title("GeoCIM · 三维数据探索").inner_size(1440.0,960.0).build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("GeoCIM desktop startup failed")
        .run(|app,event| { if let tauri::RunEvent::Exit = event { if let Some(mut child)=app.state::<Backend>().0.lock().unwrap().take() {let _=child.kill();let _=child.wait();} } });
}
