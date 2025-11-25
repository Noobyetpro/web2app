#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { URL } = require("url");
const https = require("https");
const http = require("http");

function runCommand(command) {
  return new Promise((resolve, reject) => {
    const p = spawn(command, {
      shell: true,
      stdio: ["pipe", "pipe", "pipe"]
    });

    p.stdout.on("data", (buffer) => {
      const text = buffer.toString();

      if (
        text.startsWith("neu:") ||
        text.startsWith("_   _") ||
        text.includes("INFO") ||
        text.includes("WARN") ||
        text.includes("Extracting") ||
        text.includes("patching")
      ) return;

      if (
        text.includes("press") ||
        text.includes("Press") ||
        text.includes("y/n") ||
        text.includes("confirm")
      ) {
        p.stdin.write("\n");
      }
    });

    p.stderr.on("data", () => {});

    p.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed: ${command}`));
    });
  });
}

function checkIframeSupport(targetUrl) {
  return new Promise((resolve) => {
    const client = targetUrl.startsWith("https") ? https : http;

    const req = client.request(targetUrl, { method: "HEAD" }, (res) => {
      const xfo = res.headers["x-frame-options"];
      const csp = res.headers["content-security-policy"];
      resolve(!(xfo || (csp && csp.includes("frame-ancestors"))));
    });

    req.on("error", () => resolve(false));
    req.end();
  });
}

function findBinary(dir, name) {
  const items = fs.readdirSync(dir, { withFileTypes: true });

  for (const it of items) {
    const full = path.join(dir, it.name);

    if (it.isDirectory()) {
      const found = findBinary(full, name);
      if (found) return found;
    }

    if (it.isFile() && it.name.startsWith(name)) return full;
  }

  return null;
}

function flattenNestedOutput(baseDir, name) {
  if (!fs.existsSync(baseDir)) return null;

  const outer = path.join(baseDir, name);
  const inner = path.join(outer, name);

  if (
    !fs.existsSync(inner) ||
    !fs.lstatSync(inner).isDirectory() ||
    !fs.lstatSync(outer).isDirectory()
  ) {
    return null;
  }

  for (const entry of fs.readdirSync(inner)) {
    fs.renameSync(path.join(inner, entry), path.join(outer, entry));
  }

  fs.rmSync(inner, { recursive: true, force: true });
  return outer;
}

function moveBuildOutOfBin(appDir, name) {
  const binDir = path.join(appDir, "bin");
  if (!fs.existsSync(binDir)) return null;

  const candidates = [
    path.join(binDir, "release", name),
    path.join(binDir, name)
  ];

  let source = null;

  for (const cand of candidates) {
    if (fs.existsSync(cand) && fs.lstatSync(cand).isDirectory()) {
      const inner = path.join(cand, name);
      source =
        fs.existsSync(inner) && fs.lstatSync(inner).isDirectory() ? inner : cand;
      break;
    }
  }

  const target = path.join(appDir, name);

  if (source && !fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
      fs.renameSync(path.join(source, entry), path.join(target, entry));
    }
  }

  fs.rmSync(binDir, { recursive: true, force: true });
  return fs.existsSync(target) ? target : null;
}

function printUsage() {
  console.log("Usage: web2app <url> [--icon=/path/to/icon] [--name=appName]");
}

const args = process.argv.slice(2);
if (!args[0] || args.includes("--help") || args.includes("-h")) {
  printUsage();
  process.exit(1);
}

let url = args[0].startsWith("http") ? args[0] : "https://" + args[0];
let iconPath = null;
let appName = "WebApp";

for (const a of args.slice(1)) {
  if (a.startsWith("--icon=")) iconPath = a.split("=")[1];
  if (a.startsWith("--name=")) {
    appName = a.split("=")[1].replace(/[^a-zA-Z0-9_-]/g, "") || appName;
  }
}

const binaryName = appName.replace(/\s+/g, "-").toLowerCase();

try {
  new URL(url);
} catch {
  printUsage();
  process.exit(1);
}

const cwd = process.cwd();
const appDir = path.join(cwd, "web2app_build");
const resourcesDir = path.join(appDir, "resources");

fs.mkdirSync(resourcesDir, { recursive: true });

const config = {
  applicationId: `js.neutralino.${binaryName}`,
  version: "1.0.0",
  name: appName,
  defaultMode: "window",
  url: "/",
  documentRoot: "/resources/",
  enableServer: true,
  enableNativeAPI: false,
  modes: {
    window: { title: appName, width: 1000, height: 800 }
  },
  cli: {
    resourcesPath: "/resources/",
    distributionPath: ".",
    binaryName
  }
};

if (iconPath) {
  const resolved = path.isAbsolute(iconPath)
    ? iconPath
    : path.resolve(cwd, iconPath);

  if (fs.existsSync(resolved)) {
    const file = path.basename(resolved);
    fs.copyFileSync(resolved, path.join(resourcesDir, file));
    config.modes.window.icon = `/resources/${file}`;
  }
}

(async () => {
  console.log("+ Creating app structure...");

  const iframeOK = await checkIframeSupport(url);

  fs.writeFileSync(
    path.join(resourcesDir, "index.html"),
    iframeOK
      ? `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${appName}</title><style>html,body{margin:0;height:100%}iframe{width:100%;height:100%;border:0}</style></head><body><iframe src="${url}" sandbox="allow-forms allow-same-origin allow-scripts allow-popups allow-modals"></iframe></body></html>`
      : "<!doctype html><html><body></body></html>",
    "utf8"
  );

  if (!iframeOK) config.url = url;

  fs.writeFileSync(
    path.join(appDir, "neutralino.config.json"),
    JSON.stringify(config, null, 2)
  );

  process.chdir(appDir);

  console.log("+ Updating Neutralino...");
  await runCommand("npx @neutralinojs/neu update");

  console.log("+ Building application...");
  await runCommand("npx @neutralinojs/neu build");

  const flattenBases = [
    appDir,
    path.join(appDir, "dist"),
    path.join(appDir, "bin"),
    path.join(appDir, "bin", "release")
  ];

  let flattened = null;
  for (const base of flattenBases) {
    const result = flattenNestedOutput(base, binaryName);
    if (result) {
      flattened = result;
      break;
    }
  }

  const moved = moveBuildOutOfBin(appDir, binaryName);

  const binary = findBinary(appDir, binaryName);

  console.log("+ Build done.");
  console.log(`+ Output: ${appDir}`);
})();
