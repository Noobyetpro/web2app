# web2app-cli

Convert any website into a lightweight cross-platform desktop app (Windows, macOS, Linux) with a single command powered by NeutralinoJS. No Electron bundle and no boilerplate to maintain.

## Requirements
- Node.js 14+ and npm
- `npx @neutralinojs/neu` downloads automatically during build

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
- The folder contains the generated Neutralino binary and `resources` directory. Keep them together to run the app.
- If a site blocks iframes, the app loads the URL directly; otherwise it uses an embedded iframe.

## How it works
- Generates `neutralino.config.json` and a minimal `index.html` pointing at your target URL.
- Checks if the site allows embedding (iframe); falls back to direct load when blocked.
- Cleans up nested build folders so the final output sits directly under `web2app_build/<appname>/`.

## Release Notes
- Fixed output directory handling.
- Added pretty print for CLI output.
- Auto-delete the `webapp/bin` folder to avoid confusion.

## License
MIT
