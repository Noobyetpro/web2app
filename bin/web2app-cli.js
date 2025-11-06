#!/usr/bin/env node
/**
 * web2app-cli.js
 * Minimal Neutralino app generator from any URL.
 * Output: web2app/bin/release/<appname>/<appname>.[exe|app|binary]
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { URL } = require("url");
const https = require("https");
const http = require("http");

// -------- CLI args --------
const args = process.argv.slice(2);
if (!args[0]) {
  console.log("Usage: web2app <url> [--icon=icon.png] [--name=AppName]");
  process.exit(1);
}

let url = args[0].startsWith("http") ? args[0] : "https://" + args[0];
let iconPath = null;
let appName = "WebApp";

args.slice(1).forEach((a) => {
  if (a.startsWith("--icon=")) iconPath = a.split("=")[1];
  if (a.startsWith("--name=")) appName = a.split("=")[1].replace(/[^a-zA-Z0-9_-]/g, "") || appName;
});

const binaryName = appName.replace(/\s+/g, "-").toLowerCase();
new URL(url); // validate

// -------- Paths --------
const appDir = path.join(__dirname, "..", "bin", "release", binaryName);
const resourcesDir = path.join(appDir, "resources");
fs.mkdirSync(resourcesDir, { recursive: true });

// -------- Config --------
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
    window: {
      title: appName,
      width: 1000,
      height: 800
    }
  },
  cli: {
    resourcesPath: "/resources/",
    distributionPath: ".",
    binaryName
  }
};

// -------- Icon --------
if (iconPath) {
  const resolved = path.isAbsolute(iconPath) ? iconPath : path.resolve(process.cwd(), iconPath);
  if (fs.existsSync(resolved)) {
    const iconFile = path.basename(resolved);
    fs.copyFileSync(resolved, path.join(resourcesDir, iconFile));
    config.modes.window.icon = `/resources/${iconFile}`;
  }
}

// -------- Check iframe support --------
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

// -------- Generate files --------
(async () => {
  const iframeOK = await checkIframeSupport(url);
  fs.writeFileSync(
    path.join(resourcesDir, "index.html"),
    iframeOK
      ? `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${appName}</title><style>html,body{margin:0;height:100%}iframe{width:100%;height:100%;border:none}</style></head>
<body><iframe src="${url}" sandbox="allow-forms allow-same-origin allow-scripts allow-popups allow-modals"></iframe></body></html>`
      : "<!doctype html><html><body></body></html>",
    "utf8"
  );
  if (!iframeOK) config.url = url;
  fs.writeFileSync(path.join(appDir, "neutralino.config.json"), JSON.stringify(config, null, 2));

  console.log("Scaffold created at:", appDir);
  process.chdir(appDir);

  execSync("npx @neutralinojs/neu update", { stdio: "inherit" });
  execSync("npx @neutralinojs/neu build", { stdio: "inherit" });

  const platform =
    process.platform === "win32" ? "win_x64" :
    process.platform === "darwin" ? "mac_x64" : "linux_x64";
  const buildPath = path.join(appDir, `${binaryName}-${platform}`, `${binaryName}${process.platform === "win32" ? ".exe" : ""}`);
  if (fs.existsSync(buildPath)) {
    fs.renameSync(buildPath, path.join(appDir, path.basename(buildPath)));
    fs.rmSync(path.dirname(buildPath), { recursive: true, force: true });
  }

  console.log("Build complete:", path.join(appDir, path.basename(buildPath)));
})();
