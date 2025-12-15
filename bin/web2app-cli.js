#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { URL } = require("url");
const https = require("https");
const http = require("http");
const extract = require("extract-zip");

const NEU_BINARIES = [
  "neutralino-linux_x64",
  "neutralino-linux_armhf",
  "neutralino-linux_arm64",
  "neutralino-mac_x64",
  "neutralino-mac_arm64",
  "neutralino-mac_universal",
  "neutralino-win_x64.exe"
];
const NEU_RELEASE_API =
  "https://api.github.com/repos/neutralinojs/neutralinojs/releases/latest";
const DEFAULT_NEU_TAG = "v6.4.0";

function runCommand(command, opts = {}) {
  const { allowFail = false, stdinData = null, timeoutMs = null } = opts;
  return new Promise((resolve, reject) => {
    const p = spawn(command, {
      shell: true,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let capturedStdout = "";
    let capturedStderr = "";
    let stdinClosed = false;
    let timedOut = false;
    let finished = false;
    let timer = null;

    const sendInput = (data) => {
      if (stdinClosed || !p.stdin.writable) return;
      p.stdin.write(data);
    };

    if (stdinData !== null) {
      sendInput(stdinData);
    }

    p.stdout.on("data", (buffer) => {
      const text = buffer.toString();

      if (capturedStdout.length < 8000) capturedStdout += text;

      // Auto-suppress noisy art/log lines.
      if (
        text.startsWith("neu:") ||
        text.startsWith("_   _") ||
        text.includes("INFO") ||
        text.includes("WARN") ||
        text.includes("Extracting") ||
        text.includes("patching")
      ) return;

      // Auto-confirm common prompts.
      if (
        /\bpress\b.*key/i.test(text) ||
        /\by\/n\b/i.test(text) ||
        /confirm/i.test(text)
      ) {
        sendInput("y\n");
      }
    });

    p.stderr.on("data", (buffer) => {
      const text = buffer.toString();
      if (capturedStderr.length < 8000) capturedStderr += text;
    });

    if (timeoutMs && Number.isFinite(timeoutMs)) {
      timer = setTimeout(() => {
        timedOut = true;
        try {
          p.kill();
        } catch {}
      }, timeoutMs);
    }

    const finalize = (code) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);

      if (!stdinClosed) {
        try {
          p.stdin.end();
        } catch {}
      }
      stdinClosed = true;

      const timeoutMsg = timedOut
        ? `Command timed out after ${timeoutMs}ms: ${command}`
        : null;
      if (timedOut && !allowFail) {
        const msg = timeoutMsg || "Command timed out.";
        const body = capturedStdout || capturedStderr;
        return reject(new Error(body ? `${msg}\n${body}` : msg));
      }

      if (code === 0 || allowFail) {
        if (code !== 0) {
          console.warn(
            `! Command failed (${code}): ${command}\n${capturedStdout || capturedStderr || "no output"}`
          );
        }
        if (timeoutMsg) {
          console.warn(`! ${timeoutMsg}`);
        }
        resolve({ code, stdout: capturedStdout, stderr: capturedStderr });
      } else {
        const msg =
          capturedStdout || capturedStderr
            ? `Command failed (${code}): ${command}\n${capturedStdout || capturedStderr}`
            : `Command failed: ${command}`;
        reject(new Error(msg));
      }
    };

    p.on("exit", finalize);
    p.on("close", finalize);
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

    // Prevent hanging if the host is slow/unreachable.
    req.setTimeout(3000, () => {
      req.destroy(new Error("timeout"));
    });

    req.on("error", () => resolve(false));
    req.end();
  });
}

function getMissingNeutralinoBinaries(baseDir) {
  const binDir = path.join(baseDir, "bin");
  if (!fs.existsSync(binDir)) return [...NEU_BINARIES];

  const present = new Set(fs.readdirSync(binDir));
  return NEU_BINARIES.filter((file) => !present.has(file));
}

function normalizeNeuTag(tag) {
  if (!tag) return DEFAULT_NEU_TAG;
  return tag.startsWith("v") ? tag : `v${tag}`;
}

async function fetchLatestNeutralinoTag() {
  return new Promise((resolve) => {
    const fallback = () => resolve(DEFAULT_NEU_TAG);
    try {
      const req = https.request(
        NEU_RELEASE_API,
        { headers: { "User-Agent": "web2app-cli" } },
        (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk.toString("utf8")));
          res.on("end", () => {
            if (res.statusCode === 200) {
              try {
                const parsed = JSON.parse(body);
                if (parsed && parsed.tag_name) {
                  return resolve(normalizeNeuTag(parsed.tag_name));
                }
              } catch {}
            }
            fallback();
          });
        }
      );
      req.setTimeout(3000, () => req.destroy(new Error("timeout")));
      req.on("error", fallback);
      req.end();
    } catch {
      fallback();
    }
  });
}

function downloadWithRedirect(url, destPath, redirectCount = 0) {
  const maxRedirects = 5;
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    const req = client.get(
      url,
      { headers: { "User-Agent": "web2app-cli" } },
      (res) => {
        const isRedirect = [301, 302, 303, 307, 308].includes(res.statusCode);
        if (isRedirect && res.headers.location) {
          req.destroy();
          if (redirectCount >= maxRedirects) {
            return reject(
              new Error(`Too many redirects while fetching ${url}`)
            );
          }
          const location = res.headers.location.startsWith("http")
            ? res.headers.location
            : new URL(res.headers.location, url).toString();
          return resolve(
            downloadWithRedirect(location, destPath, redirectCount + 1)
          );
        }

        if (res.statusCode !== 200) {
          return reject(
            new Error(
              `Unexpected status ${res.statusCode} while downloading ${url}`
            )
          );
        }

        const file = fs.createWriteStream(destPath);
        res.pipe(file);
        res.on("error", reject);
        file.on("finish", () => file.close(resolve));
        file.on("error", reject);
      }
    );

    req.setTimeout(5 * 60 * 1000, () => {
      req.destroy(new Error("download timeout"));
    });
    req.on("error", reject);
  });
}

async function downloadNeutralinoDirectly(baseDir) {
  const forcedTag =
    process.env.WEB2APP_NEU_TAG || process.env.NEUTRALINO_TAG || null;
  const tag = normalizeNeuTag(forcedTag || (await fetchLatestNeutralinoTag()));
  const url = `https://github.com/neutralinojs/neutralinojs/releases/download/${tag}/neutralinojs-${tag}.zip`;
  const tmpDir = path.join(baseDir, ".neu_download");
  const zipPath = path.join(tmpDir, "neutralinojs.zip");
  const binDir = path.join(baseDir, "bin");

  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(binDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    await downloadWithRedirect(url, zipPath);
    await extract(zipPath, { dir: tmpDir });

    fs.mkdirSync(binDir, { recursive: true });
    for (const file of NEU_BINARIES) {
      const src = path.join(tmpDir, file);
      if (!fs.existsSync(src)) continue;
      const dest = path.join(binDir, file);
      fs.copyFileSync(src, dest);
      if (process.platform !== "win32" && !file.endsWith(".exe")) {
        fs.chmodSync(dest, 0o755);
      }
    }
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }

  const missingAfter = getMissingNeutralinoBinaries(baseDir);
  if (missingAfter.length) {
    throw new Error(
      `Direct Neutralino download incomplete (missing: ${missingAfter.join(
        ", "
      )}).`
    );
  }
}

async function ensureNeutralinoBinaries(neuCmd, baseDir) {
  const missingBefore = getMissingNeutralinoBinaries(baseDir);
  if (missingBefore.length === 0) {
    console.log("+ Found cached Neutralino runtimes in ./bin");
    return;
  }

  const preferDirectDownload =
    process.env.WEB2APP_NEU_DIRECT === "1" ||
    process.env.WEB2APP_NEU_DIRECT === "true";

  let triedNeuUpdate = false;
  if (!preferDirectDownload) {
    console.log("+ Downloading Neutralino runtimes via neu...");
    triedNeuUpdate = true;
    try {
      await runCommand(`${neuCmd} update --latest`, {
        stdinData: "y\n",
        timeoutMs: 5 * 60 * 1000
      });
    } catch (err) {
      console.warn(
        `! neu update failed: ${err.message.trim()}. Falling back to direct download.`
      );
    }
  }

  const missingAfterNeu = getMissingNeutralinoBinaries(baseDir);
  if (preferDirectDownload || missingAfterNeu.length) {
    if (triedNeuUpdate && !preferDirectDownload && !missingAfterNeu.length) {
      console.warn(
        "! neu update returned success but binaries are still missing; retrying with direct download."
      );
    }

    console.log("+ Downloading Neutralino runtimes directly from GitHub...");
    await downloadNeutralinoDirectly(baseDir);
  }
}

function getNeuVersion(cmdPath) {
  const raw = cmdPath.trim();
  const quoted = raw.includes(" ") ? `"${raw}"` : raw;
  const isPs1 = raw.toLowerCase().endsWith(".ps1");

  const attempts = [];
  for (const sub of ["version", "--version", "-v"]) {
    attempts.push({
      file: raw,
      args: [sub],
      opts: { encoding: "utf8", stdio: "pipe", shell: process.platform === "win32" }
    });
    attempts.push({
      file: `${quoted} ${sub}`,
      args: [],
      opts: { encoding: "utf8", stdio: "pipe", shell: true }
    });

    if (process.platform === "win32" && isPs1) {
      attempts.push({
        file: "powershell",
        args: [
          "-NoLogo",
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          raw,
          sub
        ],
        opts: { encoding: "utf8", stdio: "pipe", shell: false }
      });
    }
  }

  for (const attempt of attempts) {
    try {
      const res = spawnSync(attempt.file, attempt.args, attempt.opts);
      if (res.status === 0 && !res.error) {
        const out = (res.stdout || "").toString().trim();
        if (!out) return "detected";

        const lines = out
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);

        let version = null;

        for (const line of lines) {
          const m = line.match(/neu\s*cli[:\s]+(v?[\w.\-]+)/i);
          if (m) {
            version = m[1];
            break;
          }
        }

        if (!version) {
          const semver = out.match(/v?\d+\.\d+\.\d+(?:[.\w-]*)?/);
          if (semver) version = semver[0];
        }

        return version || "detected";
      }
    } catch {}
  }

  return null;
}

function findNeutralinoCommand() {
  // Fast path: if `neu` is already on PATH, use it and skip further scanning/installation.
  const shellVersion = getNeuVersion("neu");
  if (shellVersion) {
    console.log(`+ Using Neutralino CLI (${shellVersion}): neu`);
    return "neu";
  }

  const localNeu = path.join(
    __dirname,
    "..",
    "node_modules",
    ".bin",
    process.platform === "win32" ? "neu.cmd" : "neu"
  );

  const exeName = process.platform === "win32" ? "neu.cmd" : "neu";
  const exeNamePs1 = "neu.ps1";
  const exeNameExe = "neu.exe";

  const candidates = new Set(
    [
      process.env.NEU_BIN,
      localNeu,
      exeName, // PATH lookup
      process.platform === "win32" && process.env.APPDATA
        ? path.join(process.env.APPDATA, "npm", "neu.cmd")
        : null
    ].filter(Boolean)
  );

  // Scan PATH entries manually (PowerShell shims like neu.ps1 may not be found by `where`).
  if (process.platform === "win32" && process.env.Path) {
    const paths = process.env.Path.split(";");
    for (const p of paths) {
      if (!p) continue;
      const maybeCmd = path.join(p, exeName);
      const maybePs1 = path.join(p, exeNamePs1);
      const maybeExe = path.join(p, exeNameExe);
      [maybeCmd, maybePs1, maybeExe].forEach((cand) => {
        if (fs.existsSync(cand)) candidates.add(cand);
      });
    }
  }

  // Prefer explicit bin path reported by npm if available.
  try {
    const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
    const npmBin = spawnSync(npmCmd, ["bin", "-g"], { encoding: "utf8" });
    if (npmBin.status === 0 && npmBin.stdout) {
      const globalBin = npmBin.stdout.trim();
      if (globalBin) {
        candidates.add(path.join(globalBin, exeName));
        candidates.add(path.join(globalBin, "neu.ps1"));
      }
    }
  } catch {}

  // Fallback to OS locator to capture shims (e.g., neu.ps1) that live on PATH.
  try {
    const locator = process.platform === "win32" ? "where" : "which";
    const located = spawnSync(locator, ["neu"], { encoding: "utf8" });
    if (located.status === 0 && located.stdout) {
      located.stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .forEach((p) => candidates.add(p));
    }
  } catch {}

  for (const candidate of candidates) {
    const version = getNeuVersion(candidate);
    if (version) {
      const normalized = candidate.includes(" ") ? `"${candidate}"` : candidate;
      console.log(`+ Using Neutralino CLI (${version}): ${candidate}`);
      return normalized;
    }
  }

  return null;
}

async function resolveNeutralinoCommand() {
  const found = findNeutralinoCommand();
  if (found) return found;

  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  console.log("+ Neutralino CLI not detected; installing globally...");
  await runCommand(`${npmCmd} install -g @neutralinojs/neu`);

  const installed = findNeutralinoCommand();
  if (installed) return installed;

  throw new Error("Neutralino CLI missing after global install. Install it manually and re-run.");
}

function listExecutables(baseDir, binaryName) {
  const buildDir = path.join(baseDir, binaryName);

  const result = { executables: [], archives: [] };
  if (!fs.existsSync(buildDir)) return result;

  for (const entry of fs.readdirSync(buildDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;

    if (entry.name.endsWith("-release.zip")) {
      result.archives.push(path.join(buildDir, entry.name));
      continue;
    }

    if (entry.name.startsWith(binaryName) && entry.name !== "resources.neu") {
      result.executables.push(path.join(buildDir, entry.name));
    }
  }

  return result;
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

  const neuCmd = await resolveNeutralinoCommand();

  await ensureNeutralinoBinaries(neuCmd, appDir);

  console.log("+ Building executables...");
  await runCommand(`${neuCmd} build --release --embed-resources`);

  const outputDir = path.join(appDir, binaryName);
  const { executables, archives } = listExecutables(appDir, binaryName);

  console.log("+ Build done.");

  console.log(`+ Output directory: ${outputDir}`);

  const IuseArchBtw = [
    { path: path.join(appDir, `${binaryName}-release.zip`), label: "release zip" },
    { path: resourcesDir, label: "resources folder" },
    { path: path.join(appDir, "bin"), label: "Neutralino runtime cache (bin)" }
  ];

  for (const target of IuseArchBtw) {
    if (fs.existsSync(target.path)) {
      try {
        fs.rmSync(target.path, { recursive: true, force: true });
      } catch (err) {
        console.warn(`! Failed to remove ${target.label}: ${err.message}`);
      }
    }
  }
})();
