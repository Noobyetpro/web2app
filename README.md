# web2app-cli

Convert any website into a lightweight cross-platform desktop app (Windows, macOS, Linux) with a single command powered by NeutralinoJS. No Electron bundle and no boilerplate to maintain.

## Requirements
- Node.js 14+ and npm
- Neutralino CLI is reused when already installed (`NEU_BIN`, local `node_modules/.bin/neu`, or `neu` on your PATH); if missing, it is installed globally once via `npm install -g @neutralinojs/neu`

## Installation
```bash
npm install -g web2app-cli
```

## Usage
```bash
web2app <url> [--icon=/path/to/icon] [--name=AppName]
```

**Options**
- `--icon=` path to an `.ico`, `.icns`, `.png`, or `.svg` file to use as the window icon.
- `--name=` custom application name; defaults to `WebApp`.

**Example**
```bash
web2app https://example.com --icon=./icon.ico --name=ExampleApp
```

## Output
- Builds into `web2app_build/<appname>/`.
- Produces release executables for Windows (`-win_x64.exe`), macOS (`-mac_x64`, `-mac_arm64`, `-mac_universal`), and Linux (`-linux_x64`, `-linux_armhf`, `-linux_arm64`) with resources embedded (no standalone `resources.neu`).
- Generates a ready-to-ship `<appname>-release.zip` alongside the executables, then removes the zip for a clean output (executables stay).
- Downloads Neutralino runtimes into `web2app_build/bin` on first run, then removes the cache; subsequent builds re-download automatically.
- If a site blocks iframes, the app loads the URL directly; otherwise it uses an embedded iframe.

## How it works
- Generates `neutralino.config.json` and a minimal `index.html` pointing at your target URL.
- Checks if the site allows embedding (iframe); falls back to direct load when blocked.
- Downloads Neutralino runtimes (all platforms) on first run, calls `neu build --release --embed-resources` to generate executables, then deletes the temporary `bin/` and generated `resources/` folder.
- If `neu update` fails or is blocked, the CLI falls back to downloading the Neutralino release zip directly from GitHub; set `WEB2APP_NEU_DIRECT=1` to force that path.
- Installs the Neutralino CLI globally only when no existing installation is found, so it can be reused across projects.

## Release Notes
- Automatic scan for an existing Neutralino CLI (`NEU_BIN`, local `node_modules/.bin/neu`, PATH, npm global bin) before installing globally.
- Builds release executables for all platforms with embedded resources (no `resources.neu` alongside the binary); cleans bin/resources/release zip after build.
- Falls back to downloading Neutralino runtimes directly from GitHub if `neu update --latest` fails (`WEB2APP_NEU_DIRECT=1` to force).

## License
MIT
