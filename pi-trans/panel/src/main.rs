//! Small native-webview popup. stdout is reserved for newline-delimited JSON.
#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]
use serde_json::{json, Value};
use std::io::{self, BufRead, Write};
use tao::{
    dpi::{LogicalSize, PhysicalPosition},
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder},
    window::{Window, WindowBuilder},
};
use wry::{WebView, WebViewBuilder};

#[derive(Debug)]
enum Message {
    Command(Value),
    Ipc(Value),
    Eof,
}
fn emit(value: Value) {
    let mut out = io::stdout().lock();
    let _ = writeln!(out, "{value}");
    let _ = out.flush();
}
fn update(view: &WebView, value: &Value) {
    // Serialize as data, never interpolate user-provided text as executable code.
    let _ = view.evaluate_script(&format!("window.updatePanel({value})"));
}
fn dismiss(window: &Window, active: &mut Option<Value>) {
    if let Some(id) = active.take() {
        window.set_visible(false);
        emit(json!({"type":"closed", "id":id}));
    }
}
fn position(
    window: &Window,
    view: &WebView,
    anchor: PhysicalPosition<f64>,
    width: f64,
    height: f64,
) {
    let monitor = window.available_monitors().min_by(|a, b| {
        let distance = |m: &tao::monitor::MonitorHandle| {
            let p = m.position();
            let s = m.size();
            let dx = (p.x as f64 - anchor.x)
                .max(0.0)
                .max(anchor.x - p.x as f64 - s.width as f64);
            let dy = (p.y as f64 - anchor.y)
                .max(0.0)
                .max(anchor.y - p.y as f64 - s.height as f64);
            dx * dx + dy * dy
        };
        distance(a).total_cmp(&distance(b))
    });
    let Some(monitor) = monitor else {
        return;
    };
    let scale = monitor.scale_factor();
    let (left, top, area_width, area_height) = work_area(&monitor);
    let (x, y, width, height, above) = place(
        anchor.x,
        anchor.y,
        left,
        top,
        area_width,
        area_height,
        scale,
        width,
        height,
    );
    window.set_inner_size(LogicalSize::new(width, height));
    window.set_outer_position(PhysicalPosition::new(x.round() as i32, y.round() as i32));
    let _ = view.evaluate_script(&format!(
        "window.placePanel({})",
        json!({"placement":if above {"above"} else {"below"}})
    ));
}
// The window library exposes full monitor bounds, not the usable work area.
fn work_area(monitor: &tao::monitor::MonitorHandle) -> (f64, f64, f64, f64) {
    let p = monitor.position();
    let s = monitor.size();
    let fallback = (p.x as f64, p.y as f64, s.width as f64, s.height as f64);
    #[cfg(target_os = "macos")]
    {
        use tao::platform::macos::MonitorHandleExtMacOS;
        if let Some(screen) = monitor.ns_screen() {
            // ns_screen is borrowed from the live monitor; no ownership transfer.
            let screen = unsafe { &*(screen as *const objc2_app_kit::NSScreen) };
            let frame = screen.frame();
            let visible = screen.visibleFrame();
            let scale = monitor.scale_factor();
            return (
                fallback.0 + (visible.origin.x - frame.origin.x) * scale,
                fallback.1
                    + (frame.origin.y + frame.size.height - visible.origin.y - visible.size.height)
                        * scale,
                visible.size.width * scale,
                visible.size.height * scale,
            );
        }
    }
    #[cfg(target_os = "windows")]
    {
        #[repr(C)]
        struct Point {
            x: i32,
            y: i32,
        }
        #[repr(C)]
        #[derive(Default)]
        struct Rect {
            left: i32,
            top: i32,
            right: i32,
            bottom: i32,
        }
        #[repr(C)]
        struct Info {
            size: u32,
            monitor: Rect,
            work: Rect,
            flags: u32,
        }
        #[link(name = "user32")]
        extern "system" {
            fn MonitorFromPoint(point: Point, flags: u32) -> isize;
            fn GetMonitorInfoW(monitor: isize, info: *mut Info) -> i32;
        }
        let mut info = Info {
            size: std::mem::size_of::<Info>() as u32,
            monitor: Rect::default(),
            work: Rect::default(),
            flags: 0,
        };
        unsafe {
            let handle = MonitorFromPoint(
                Point {
                    x: p.x + s.width as i32 / 2,
                    y: p.y + s.height as i32 / 2,
                },
                2,
            );
            if GetMonitorInfoW(handle, &mut info) != 0 {
                let r = info.work;
                return (
                    r.left as f64,
                    r.top as f64,
                    (r.right - r.left) as f64,
                    (r.bottom - r.top) as f64,
                );
            }
        }
    }
    fallback
}
fn place(
    ax: f64,
    ay: f64,
    left: f64,
    top: f64,
    aw: f64,
    ah: f64,
    scale: f64,
    width: f64,
    height: f64,
) -> (f64, f64, f64, f64, bool) {
    let width = width.clamp(300.0, 560.0).min(aw / scale);
    let height = height.clamp(140.0, 480.0).min(ah / scale);
    let w = width * scale;
    let h = height * scale;
    let above = ay - h - 14.0 * scale >= top;
    let x = (ax - 38.0 * scale).clamp(left, left + aw - w);
    let y = (if above {
        ay - h - 14.0 * scale
    } else {
        ay + 14.0 * scale
    })
    .clamp(top, top + ah - h);
    (x, y, width, height, above)
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut event_loop = EventLoopBuilder::<Message>::with_user_event().build();
    #[cfg(target_os = "macos")]
    {
        use tao::platform::macos::{ActivationPolicy, EventLoopExtMacOS};
        event_loop.set_activation_policy(ActivationPolicy::Accessory);
    }
    let builder = WindowBuilder::new()
        .with_title("pi-trans")
        .with_visible(false)
        .with_decorations(false)
        .with_transparent(true)
        .with_always_on_top(true)
        .with_resizable(false)
        .with_visible_on_all_workspaces(true)
        .with_inner_size(LogicalSize::new(408.0, 220.0));
    #[cfg(target_os = "macos")]
    let builder = {
        use tao::platform::macos::WindowBuilderExtMacOS;
        builder.with_has_shadow(false)
    };
    #[cfg(target_os = "windows")]
    let builder = {
        use tao::platform::windows::WindowBuilderExtWindows;
        builder
            .with_skip_taskbar(true)
            .with_undecorated_shadow(false)
    };
    let window = builder.build(&event_loop)?;
    let proxy = event_loop.create_proxy();
    let ipc_proxy = proxy.clone();
    let view = WebViewBuilder::new()
        .with_transparent(true)
        .with_html(include_str!("../popup.html"))
        .with_ipc_handler(move |request| {
            if let Ok(value) = serde_json::from_str(request.body()) {
                let _ = ipc_proxy.send_event(Message::Ipc(value));
            }
        })
        .with_navigation_handler(|url| url == "about:blank" || url.starts_with("about:blank#"))
        .with_new_window_req_handler(|_, _| wry::NewWindowResponse::Deny)
        .with_permission_handler(|_| wry::PermissionResponse::Deny)
        .build(&window)?;
    std::thread::spawn(move || {
        for line in io::stdin().lock().lines() {
            let Ok(line) = line else {
                break;
            };
            if let Ok(value) = serde_json::from_str(&line) {
                if proxy.send_event(Message::Command(value)).is_err() {
                    return;
                }
            }
        }
        let _ = proxy.send_event(Message::Eof);
    });
    let mut active: Option<Value> = None;
    let mut anchor = PhysicalPosition::new(0.0, 0.0);
    let mut clipboard = arboard::Clipboard::new().ok();
    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        match event {
            Event::UserEvent(Message::Eof) => *control_flow = ControlFlow::Exit,
            Event::UserEvent(Message::Ipc(value)) if value["type"] == "ready" => {
                emit(json!({"type":"ready"}))
            }
            Event::UserEvent(Message::Command(value)) => {
                match value["type"].as_str().unwrap_or("") {
                    "quit" => *control_flow = ControlFlow::Exit,
                    "clipboard" => {
                        let result = clipboard
                            .as_mut()
                            .ok_or_else(|| "Clipboard unavailable".to_owned())
                            .and_then(|c| c.get_text().map_err(|e| e.to_string()));
                        match result {
                            Ok(text) => {
                                emit(json!({"type":"clipboard","id":value["id"],"text":text}))
                            }
                            Err(error) => {
                                emit(json!({"type":"clipboard","id":value["id"],"error":error}))
                            }
                        }
                    }
                    "show" if value["id"].is_string() => {
                        dismiss(&window, &mut active);
                        active = Some(value["id"].clone());
                        anchor = window
                            .cursor_position()
                            .unwrap_or(PhysicalPosition::new(0.0, 0.0));
                        position(&window, &view, anchor, 408.0, 220.0);
                        update(&view, &value);
                        window.set_visible(true);
                        window.set_focus();
                        let _ = view.focus();
                        emit(json!({"type":"shown","id":value["id"]}));
                    }
                    "close" if active.as_ref() == Some(&value["id"]) => {
                        dismiss(&window, &mut active)
                    }
                    "result" if active.as_ref() == Some(&value["id"]) => update(&view, &value),
                    _ => {}
                }
            }
            Event::UserEvent(Message::Ipc(value))
                if active.is_some() && active.as_ref() == Some(&value["id"]) =>
            {
                match value["type"].as_str().unwrap_or("") {
                    "close" => dismiss(&window, &mut active),
                    "copy" => {
                        if let (Some(c), Some(text)) = (clipboard.as_mut(), value["text"].as_str())
                        {
                            let _ = c.set_text(text.to_owned());
                        }
                    }
                    "resize" => {
                        if let (Some(w), Some(h)) =
                            (value["width"].as_f64(), value["height"].as_f64())
                        {
                            if w.is_finite() && h.is_finite() {
                                position(&window, &view, anchor, w, h);
                            }
                        }
                    }
                    _ => {}
                }
            }
            Event::WindowEvent {
                event: WindowEvent::Focused(false) | WindowEvent::CloseRequested,
                ..
            } => dismiss(&window, &mut active),
            _ => {}
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn above_and_below() {
        assert!(place(400., 600., 0., 0., 1920., 1080., 1., 408., 220.).4);
        let (_, y, _, _, above) = place(400., 20., 0., 0., 1920., 1080., 1., 408., 220.);
        assert!(!above);
        assert_eq!(y, 34.);
    }
    #[test]
    fn negative_monitor_and_scaled_edges() {
        let (x, y, w, h, _) = place(-1., 700., -1920., 40., 1920., 1000., 2., 560., 480.);
        assert!(x >= -1920. && x + w * 2. <= 0.);
        assert!(y >= 40. && y + h * 2. <= 1040.);
    }
    #[test]
    fn tiny_work_area() {
        let (x, y, w, h, _) = place(10., 10., 0., 0., 200., 100., 1., 560., 480.);
        assert_eq!((x, y, w, h), (0., 0., 200., 100.));
    }
}
