# 🌐 web2app-cli

Turn any website into a standalone **Windows Electron desktop app** with a single command.

No complex boilerplate. Just pass a URL — and optionally an icon and app name — and get a `.exe` instantly. 🔥

---

## 📦 Installation

```bash
npm i -g web2app-cli
```

---

## 🚀 Usage

```bash
web2app-cli <url> [--icon=path/to/icon.ico] [--name=AppName]
```

### ✅ Example

```bash
web2app-cli https://google.com --icon=icon.ico --name=GoogleApp
```

This command creates a folder like:
```
GoogleApp-win32-x64/
├── GoogleApp.exe     ← Your desktop app!
└── ...
```

---

## 🛠 Features

- ✅ One-liner conversion from URL to `.exe`
- 🖼️ Custom app icon support (`.ico`)
- 🧾 Custom app name support (`--name`)
- ⚙️ Auto-installs dependencies (Electron)
- 🧹 Graceful error handling and icon fallback

---

## 💡 Notes

- Works on **Windows** out of the box
- Requires **Node.js** and **npm**
- Uses [`electron-packager`](https://github.com/electron/electron-packager) under the hood
- `.ico` file must be valid (use [icoconvert.com](https://icoconvert.com) if needed)

---

## 📁 Recommended Folder Setup

```
📂 my-project
├── icon.ico               ← Your app icon (optional)
├── [run command here]     ← Output will appear in same folder
```

---

## 📜 License

MIT

---

## 👤 Author

**[@noobyetpro](https://github.com/noobyetpro)**
