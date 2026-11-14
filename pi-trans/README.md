# pi-trans

Display-only bilingual translation for the [pi](https://github.com/earendil-works/pi) coding agent.

pi-trans keeps the original reply and appends a translated paragraph below each Markdown block. Translations exist only in the rendered transcript. Source messages, session files, and the agent context are never modified.

## Install

From a local checkout, install the package using its absolute path:

```sh
pi install /absolute/path/to/pi-extensions/pi-trans
```

Requires pi 1.3.0 or newer and Node.js 22.18 or newer.

## Shortcuts

| Shortcut | Action |
| --- | --- |
| `Alt+A` | Show or hide the translation of the last assistant reply |
| `Alt+S` | Translate the current draft to English in place, without sending |
| `Alt+T` | Turn auto-send on or off: while on, `Enter` translates the draft and sends it |
| `Cmd+Z` | Undo, including a draft translation; pi's own undo bindings remain |
| Select + right-click | Translate the selection in a floating card (macOS and Windows, see below) |

On macOS, Alt is the Option key, so the terminal must send Option as Meta:

- Ghostty: `macos-option-as-alt = left`
- Zed: `"terminal": { "option_as_meta": true }`
- VS Code: `"terminal.integrated.macOptionIsMeta": true`
- iTerm2: Profiles → Keys → Left Option key → Esc+

Run `/hotkeys` in pi to confirm the shortcuts are registered.

## Selection translation (macOS and Windows)

Select text in pi's fullscreen TUI (`"tuiMode": "fullscreen"`) and right-click. A small native **Rust helper built with Wry/Tao** shows a floating HTML/CSS card with the source, translation, and a copy button. It uses the system webview—WKWebView on macOS and WebView2 on Windows—instead of bundling Chromium. The card keeps system light/dark appearance, loading animation, selectable text, scrolling, and screen-edge-aware positioning. Escape, clicking outside, or switching apps closes it. Fonts and text wrapping may differ slightly between the two webview engines.

The card uses a translucent surface (91% opacity), a fine highlight border, soft shadow, subtle footer divider, and compact language badge. When the terminal reports its foreground/background colors through pi's OSC color query, the card derives a matching palette and checks text contrast. Terminals that do not report colors fall back to system light/dark appearance. Increased-contrast or reduced-transparency preferences use an opaque surface. This is transparency, not a native blur of the terminal behind the window.

Requirements and limits:

- **Local macOS or Windows desktop.** macOS supplies WKWebView. Windows requires the Microsoft Edge WebView2 Runtime, already installed on Windows 11 and most Windows 10 machines; install it separately if missing. No Electron or bundled browser download is needed.
- **A matching native helper binary, or Rust and the platform build tools for the first local build.** See [Native helper setup](#native-helper-setup) below. The runtime binary is small compared with Electron, but the Rust toolchain, Cargo downloads, and build cache take additional disk space when building locally. Exact release size depends on platform and build settings.
- The helper is prepared in the background when an interactive session starts, launched on the first selection, then reused until pi exits. Local compilation runs asynchronously; progress appears as notifications in pi, not in the input box, and typing remains available during preparation. Subsequent launches reuse the cached binary.
- The card has no Node.js access. Translation text stays local to the card renderer, with translation requests handled by the extension.
- Selected text is read through the helper's native clipboard support after pi copies it, so a right-click translation replaces the clipboard contents.
- Requires pi's fullscreen selection and a terminal that forwards right-click (for example Windows Terminal with its right-click menu disabled). It does not work over SSH, in WSL without a supported desktop setup, or in terminals that keep right-click for their own menu.
- No Accessibility or Screen Recording permission is needed. The card takes keyboard focus while open so Escape and blur dismissal work consistently on both systems; dismissing it returns interaction to the terminal.

## Native helper setup

The macOS release helper built in this checkout is **990,384 bytes (about 967 KiB)**; Windows and other architectures may differ. This excludes the OS-supplied webview and development toolchain.

If a prebuilt helper for your machine is available, install it in the package at:

```text
panel/bin/<platform>-<arch>/pi-trans-panel       # macOS
panel/bin/<platform>-<arch>/pi-trans-panel.exe   # Windows
```

The names use Node.js platform/architecture values: for example, `darwin-arm64`, `darwin-x64`, `win32-x64`, or `win32-arm64`. The macOS binary must be executable. Only use binaries from a trusted source. A matching prebuilt binary avoids the Rust build requirement; WebView2 is still required on Windows.

Without a prebuilt binary, install a stable Rust toolchain with Cargo and the native build tools:

- **macOS:** Xcode Command Line Tools (`xcode-select --install`). No Swift helper is compiled, but Rust still needs Apple's linker and SDK.
- **Windows:** Visual Studio Build Tools with the **Desktop development with C++** workload and a Windows SDK, plus the Rust MSVC toolchain matching your architecture.

An interactive session starts a background release build if no helper is available; this may take several minutes, including Cargo dependency downloads. Build output is cached outside the checkout at `~/.pi/agent/extensions/pi-trans/panel/<sourcehash>/target/release/`. A source change creates a new cache entry. Cargo's own dependency cache is separate. You can remove old panel cache directories when pi is stopped; they will be rebuilt if needed.

## Behavior

- Translation starts disabled. When enabled, only the last assistant reply is translated. User messages, thinking blocks, and tool output are not.
- While a translation runs, the editor's top border shows a spinner. The footer shows `⇄ <target>` while translation is on.
- Streaming translation waits for complete top-level blocks. Blocks over 4000 characters are skipped.
- Code blocks, tables, raw HTML, and display math are not translated. Inline code, math, links, and HTML tags are protected with placeholders.
- If a translation fails, the original stays and a warning is shown. Toggle `Alt+A` off and on to retry.
- With auto-send on (`Alt+T`), `Enter` translates the draft to English first and then sends the
  translated text, so you can type in any language without pressing `Alt+S` first. Slash commands
  and `!` bash lines are sent untranslated. `Escape` cancels a translation that is still running and
  keeps your draft; if you edit the draft while it translates, nothing is sent and the draft is kept.
  `Shift+Enter` and `Ctrl+J` still insert a newline.
- Interactive TUI only. RPC, JSON, and print modes are untouched.

## Data and privacy

Settings, the cached panel binary, and the translation cache live in
`~/.pi/agent/extensions/pi-trans/`:

- `settings.json`: `target` (default `zh-Hans`), `source` (default `auto`), `streaming`, `autoSend`
- `cache/<session-id>.json`: up to 3000 entries per session

Text being translated is sent to Microsoft through the Bing web translator. It needs no API key, but has no stable contract.

## Development

```sh
npm install
npm run dev        # only this extension; other extensions disabled, settings untouched
npm run typecheck
npm test
```

Tests inject a fake translation service and do not touch the network.

```text
src/
├── index.ts          # extension entry: shortcuts, events, Markdown transformer
├── editor.ts         # editor with the translation spinner in its border
├── latest-message.ts # limits translation to the last assistant reply
├── selection-*.ts    # right-click handling and terminal fallback card
├── native-panel.ts   # lazy native helper preparation and JSON process bridge
└── core/             # Markdown segmentation, placeholders, translator, cache
panel/                # Rust Wry/Tao helper and shared HTML/CSS card UI
```

## License

[MIT](LICENSE).
