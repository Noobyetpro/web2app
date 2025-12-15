#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn, spawnSync } = require("child_process");
const { URL } = require("url");
const https = require("https");
const http = require("http");
const readline = require("readline");
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
const isBun = !!(process.versions && process.versions.bun);

function runCommand(command, opts = {}) {
  const {
    allowFail = false,
    stdinData = null,
    timeoutMs = null,
    cwd = null,
    quiet = false
  } = opts;
  return new Promise((resolve, reject) => {
    const p = spawn(command, {
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
      cwd: cwd || undefined
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

      if (!quiet) {
        process.stdout.write(text);
      }

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
      if (!quiet) {
        process.stderr.write(text);
      }
    });

    p.on("error", (err) => {
      reject(err);
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

function getMissingNeutralinoBinaries(binDir) {
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

async function downloadNeutralinoDirectly(destBinDir) {
  const forcedTag =
    process.env.WEB2APP_NEU_TAG || process.env.NEUTRALINO_TAG || null;
  const tag = normalizeNeuTag(forcedTag || (await fetchLatestNeutralinoTag()));
  const url = `https://github.com/neutralinojs/neutralinojs/releases/download/${tag}/neutralinojs-${tag}.zip`;
  const baseDir = path.dirname(destBinDir);
  const tmpDir = path.join(baseDir, ".neu_download");
  const zipPath = path.join(tmpDir, "neutralinojs.zip");
  const binDir = destBinDir;

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

  const missingAfter = getMissingNeutralinoBinaries(binDir);
  if (missingAfter.length) {
    throw new Error(
      `Direct Neutralino download incomplete (missing: ${missingAfter.join(
        ", "
      )}).`
    );
  }
}

function getSharedNeuCacheDir() {
  if (process.env.APPDATA) {
    return path.join(process.env.APPDATA, "web2app", "NEU");
  }

  // Prefer a shared location on Linux (/usr/local/share/web2app/NEU) when writable.
  if (process.platform === "linux") {
    const usrDir = "/usr/local/share/web2app/NEU";
    try {
      fs.mkdirSync(usrDir, { recursive: true });
      fs.accessSync(usrDir, fs.constants.W_OK);
      return usrDir;
    } catch {}
  }

  return path.join(os.homedir(), ".web2app", "NEU");
}

function copySharedBinToProject(sharedBinDir, projectBinDir) {
  fs.rmSync(projectBinDir, { recursive: true, force: true });
  fs.mkdirSync(projectBinDir, { recursive: true });

  for (const file of NEU_BINARIES) {
    const src = path.join(sharedBinDir, file);
    if (!fs.existsSync(src)) {
      throw new Error(`Shared Neutralino runtime missing: ${file}`);
    }
    const dest = path.join(projectBinDir, file);
    fs.copyFileSync(src, dest);
    if (process.platform !== "win32" && !file.endsWith(".exe")) {
      fs.chmodSync(dest, 0o755);
    }
  }
}

async function ensureNeutralinoBinaries(neuCmd, baseDir) {
  const sharedBin = getSharedNeuCacheDir();
  fs.mkdirSync(sharedBin, { recursive: true });

  console.log(`+ Neutralino runtimes cache: ${sharedBin}`);

  const missingShared = getMissingNeutralinoBinaries(sharedBin);
  if (missingShared.length === 0) {
    console.log("+ Found cached Neutralino runtimes in shared cache");
  } else {
    console.log("+ Downloading Neutralino runtimes into shared cache...");
    await downloadNeutralinoDirectly(sharedBin);
  }

  const projectBin = path.join(baseDir, "bin");
  copySharedBinToProject(sharedBin, projectBin);
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

function getSharedNeuCliDir() {
  if (process.platform === "win32" && process.env.APPDATA) {
    return path.join(process.env.APPDATA, "web2app", "neu-cli");
  }
  return path.join(os.homedir(), ".web2app", "neu-cli");
}

function findNeutralinoCommand() {
  // Fast path: if `neu` is already on PATH, use it and skip further scanning/installation.
  const shellVersion = getNeuVersion("neu");
  if (shellVersion) {
    console.log(`+ Using Neutralino CLI (${shellVersion}): neu`);
    return "neu";
  }

  const sharedNeuPrefix = getSharedNeuCliDir();
  const sharedNeuBin = path.join(
    sharedNeuPrefix,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "neu.cmd" : "neu"
  );

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
        : null,
      sharedNeuBin
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

  if (isBun) {
    console.log("+ Neutralino CLI not detected; using bun x @neutralinojs/neu");
    return "bun x @neutralinojs/neu";
  }

  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const sharedPrefix = getSharedNeuCliDir();
  fs.mkdirSync(sharedPrefix, { recursive: true });

  console.log("+ Neutralino CLI not detected; installing to shared cache...");
  try {
    await runCommand(
      `${npmCmd} install --no-fund --no-audit --prefix "${sharedPrefix}" @neutralinojs/neu`,
      { timeoutMs: 5 * 60 * 1000 }
    );
  } catch (err) {
    console.warn(
      `! Failed to install Neutralino CLI in shared cache: ${err.message.trim()}`
    );
    console.log("+ Retrying with global install...");
    await runCommand(`${npmCmd} install -g @neutralinojs/neu`, {
      timeoutMs: 5 * 60 * 1000
    });
  }

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

function slugifyName(name) {
  const trimmed = (name || "").trim();
  if (!trimmed) return "web-app";
  return trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "web-app";
}

function normalizeUrlInput(raw) {
  if (!raw) return null;
  let candidate = raw.trim();
  if (!candidate) return null;

  if (!/^https?:\/\//i.test(candidate)) {
    candidate = "https://" + candidate;
  }

  try {
    new URL(candidate);
    return candidate;
  } catch {
    return null;
  }
}

function sanitizeVersion(input, fallback = "0.1.0") {
  const cleaned = (input || "").trim() || fallback;
  const semver = cleaned.match(/\d+\.\d+\.\d+(?:[-.0-9A-Za-z]*)?/);
  return semver ? semver[0] : fallback;
}

function sanitizeAppId(raw, binaryName) {
  const fallback = `com.web2app.${binaryName}`;
  if (!raw) return fallback;
  const stripped = raw
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, ".")
    .replace(/\.+/g, ".")
    .replace(/^\.+|\.+$/g, "");

  if (!stripped) return fallback;
  if (!stripped.includes(".")) return `${stripped}.${binaryName}`;
  return stripped;
}

function parseWindowSize(input, fallback) {
  if (!input) return fallback;
  const parts = input
    .toLowerCase()
    .replace(/x/, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => parseInt(p, 10));

  if (parts.length === 2 && parts.every((n) => Number.isFinite(n) && n > 300)) {
    return { width: parts[0], height: parts[1] };
  }
  return fallback;
}

function escapeHtml(str) {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function createPrompt() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.on("SIGINT", () => {
    console.log("\n! Exit requested. No files were created.");
    process.exit(1);
  });

  const ask = (q) =>
    new Promise((resolve) => rl.question(q, (answer) => resolve(answer.trim())));

  return { ask, close: () => rl.close() };
}

async function promptForBlueprint() {
  const frame = [
    "",
    "+----------------------------------------------------------+",
    "|  web2app quick setup                                    |",
    "|  Wrap any site into a desktop app in a few questions.    |",
    "|  Press Enter to accept suggestions or type your own.     |",
    "|  Tip: hit Ctrl+C any time to cancel.                     |",
    "+----------------------------------------------------------+",
    ""
  ];
  console.log(frame.join("\n"));
  console.log("Let's get your app ready. Values in [brackets] are defaults.\n");

  const { ask, close } = createPrompt();

  const defaultName = "My Web App";
  const defaultUrl = "https://example.com";
  const defaultVersion = "0.1.0";
  const defaultSize = { width: 1100, height: 820 };

  const appName =
    (await ask(`[ #1 ] Name for this app [${defaultName}]: `)) || defaultName;

  let targetUrl = null;
  let attempts = 0;
  while (!targetUrl && attempts < 3) {
    attempts += 1;
    const candidate =
      (await ask(
        `[ #2 ] Destination URL to wrap (ex: https://app.yoursite.com) [${defaultUrl}]: `
      )) || defaultUrl;
    targetUrl = normalizeUrlInput(candidate);
    if (!targetUrl) {
      console.log(
        "  ↳ That doesn't look like a full URL (try https://example.com). Please try again."
      );
    }
  }

  if (!targetUrl) {
    close();
    throw new Error("A valid URL is required to continue.");
  }

  const description =
    (await ask(
      "[ #3 ] One-line note for yourself (shows up in metadata) [optional]: "
    )) || "";

  const version = sanitizeVersion(
    (await ask(`[ #4 ] Version stamp [${defaultVersion}]: `)) ||
      defaultVersion,
    defaultVersion
  );

  const binaryName = slugifyName(appName);
  const applicationId = sanitizeAppId(
    await ask(`[ #5 ] Bundle identifier [com.web2app.${binaryName}]: `),
    binaryName
  );

  const iconPath =
    (await ask(
      "[ #6 ] Icon file (path to .ico/.icns/.png/.svg) [blank to skip]: "
    )) || null;

  const sizeInput = await ask(
    `[ #7 ] Window size WIDTHxHEIGHT [${defaultSize.width}x${defaultSize.height}]: `
  );
  const size = parseWindowSize(sizeInput, defaultSize);

  close();

  console.log("\nSetup summary:");
  console.log(`- name ........... ${appName}`);
  console.log(`- url ............ ${targetUrl}`);
  console.log(`- version ........ ${version}`);
  console.log(`- bundle id ...... ${applicationId}`);
  console.log(
    `- icon ........... ${iconPath ? iconPath : "(none provided)"}`
  );
  console.log(`- window ......... ${size.width} x ${size.height}`);
  if (description) console.log(`- note ........... ${description}`);
  console.log("");

  return {
    appName,
    url: targetUrl,
    version,
    applicationId,
    iconPath,
    windowSize: size,
    description,
    binaryName
  };
}

(async () => {
  const cwd = process.cwd();
  const appDir = path.join(cwd, "web2app_build");
  const resourcesDir = path.join(appDir, "resources");

  const {
    appName,
    url,
    version,
    applicationId,
    iconPath,
    windowSize,
    description,
    binaryName
  } = await promptForBlueprint();

  fs.mkdirSync(resourcesDir, { recursive: true });

  const config = {
    applicationId,
    version,
    name: appName,
    defaultMode: "window",
    url: "/",
    documentRoot: "/resources/",
    enableServer: true,
    enableNativeAPI: false,
    modes: {
      window: {
        title: appName,
        width: windowSize.width,
        height: windowSize.height
      }
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
    } else {
      console.warn(`! Icon not found at ${resolved}; continuing without it.`);
    }
  }

  if (description) {
    config.meta = { description };
  }

  console.log("+ Creating app structure...");

  const iframeOK = await checkIframeSupport(url);
  const metaDescription = description
    ? `<meta name="description" content="${escapeHtml(description)}"/>`
    : "";

  fs.writeFileSync(
    path.join(resourcesDir, "index.html"),
    iframeOK
      ? `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>${metaDescription}<title>${escapeHtml(appName)}</title><style>html,body{margin:0;height:100%}iframe{width:100%;height:100%;border:0}</style></head><body><iframe src="${escapeHtml(
          url
        )}" sandbox="allow-forms allow-same-origin allow-scripts allow-popups allow-modals"></iframe></body></html>`
      : "<!doctype html><html><body></body></html>",
    "utf8"
  );

  if (!iframeOK) config.url = url;

  fs.writeFileSync(
    path.join(appDir, "neutralino.config.json"),
    JSON.stringify(config, null, 2)
  );

  process.chdir(appDir);

  console.log("+ Resolving Neutralino CLI...");
  const neuCmd = await resolveNeutralinoCommand();

  console.log("+ Ensuring Neutralino runtimes...");
  await ensureNeutralinoBinaries(neuCmd, appDir);

  console.log(`+ Running neu build from ${appDir} ...`);
  // Suppress verbose neu build logs; will still bubble up on failure.
  await runCommand(`${neuCmd} build --release --embed-resources`, {
    cwd: appDir,
    quiet: true
  });

  const outputDir = path.join(appDir, binaryName);
  const { executables, archives } = listExecutables(appDir, binaryName);

  console.log("+ Build done.");

  console.log(`+ Output directory: ${outputDir}`);
  if (executables.length) {
    console.log("+ Executables generated:");
    executables.forEach((e) => console.log(`  - ${e}`));
  }
  if (archives.length) {
    console.log("+ Archives:");
    archives.forEach((a) => console.log(`  - ${a}`));
  }
  if (!executables.length && !archives.length) {
    throw new Error(
      "Neutralino build finished without outputs. Check the build logs above for errors."
    );
  }

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
})().catch((err) => {
  console.error(`! ${err.message}`);
  process.exit(1);
});
