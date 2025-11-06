Sure — here’s the complete **copy-pastable `README.md`**, updated for your current Neutralino-based `web2app-cli` implementation:


# 🌐 web2app-cli

Turn any website into a lightweight **cross-platform desktop app** (Windows / macOS / Linux) with a single command — powered by [NeutralinoJS](https://neutralino.js.org/).

No Electron bloat, no boilerplate. Just pass a URL — and optionally an icon and app name — and get a standalone app instantly.

---

## 📦 Installation

```bash
npm i -g web2app-cli
````

Requires **Node 14 +** and **npm**.

---

## 🚀 Usage

```bash
web2app-cli <url> [--icon=path/to/icon] [--name=AppName]
```

### ✅ Example

```bash
web2app-cli https://discord.gg --icon=icon.ico --name=Discord
```

Creates:

```
bin/
└── release/
    └── discord/
        ├── discord.exe                ← your app (on Windows)
        ├── neutralino.config.json
        └── resources/
            └── index.html
```

Run the executable and browse the target site in its own native window.

---

## 🛠 Features

* ⚡ One-liner conversion from URL to desktop app
* 🖼️ Custom icon support

  * `.ico` for Windows
  * `.icns` for macOS
  * `.png` or `.svg` for Linux
* 🧾 Custom app name via `--name`
* 🧱 Builds natively with [NeutralinoJS](https://neutralino.js.org/)
* 🧰 Cross-platform : Windows / macOS / Linux
* 🧹 Clean folder output under `bin/release/<appname>/`

---

## 💡 Notes

* Supply a valid icon for best OS integration

  * Example: `--icon=icon.ico` on Windows
  * Example: `--icon=icon.icns` on macOS
* The tool automatically detects if a site supports embedding; if not, it loads it directly.
* No Electron or Chromium bundle — Neutralino uses the system WebView for tiny builds.

---

## 📁 Recommended Project Layout

```
📂 web2app
├── web2app-cli.js         ← CLI script
├── icon.ico               ← optional icon
└── bin/
    └── release/
        └── myapp/
            ├──  myapp/
                 └── your applicaition is here   
            └── resources/
```

---

## 🧩 Supported Platforms

| Platform | Output | Recommended Icon |
| -------- | ------ | ---------------- |
| Windows  | `.exe` | `.ico`           |
| macOS    | `.app` | `.icns`          |
| Linux    | binary | `.png` / `.svg`  |

---

## 🧑‍💻 Build From Source

```bash
git clone https://github.com/noobyetpro/web2app-cli.git
cd web2app-cli
npm install
node web2app-cli.js https://example.com --name=Example
```

---

## 📜 License

MIT

---

## 👤 Author

**[@noobyetpro](https://github.com/noobyetpro)**
Neutralino-based rewrite by contributors.


---


