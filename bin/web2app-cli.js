#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { URL } = require('url');

// --- Parse args ---
const args = process.argv.slice(2);
if (args.length === 0 || !args[0].startsWith('http')) {
  console.log("❌ Usage: web2app-cli <url> [--icon=icon.ico] [--name=AppName]");
  process.exit(1);
}

let url = args[0];
let iconPath = null;
let appName = "WebApp";

// --- Validate URL ---
try {
  new URL(url);
} catch (err) {
  console.error("❌ Invalid URL provided.");
  process.exit(1);
}

// --- Handle optional args ---
args.slice(1).forEach(arg => {
  if (arg.startsWith('--icon=')) {
    iconPath = arg.split('=')[1];
  } else if (arg.startsWith('--name=')) {
    appName = arg.split('=')[1].replace(/[^a-zA-Z0-9_-]/g, '');
  }
});

// --- Resolve icon path if provided ---
if (!iconPath) {
  const fallback = path.join(process.cwd(), 'icon.ico');
  if (fs.existsSync(fallback)) {
    iconPath = fallback;
  } else {
    console.log("⚠️ No icon provided. Proceeding without a custom icon.");
  }
} else {
  iconPath = path.isAbsolute(iconPath)
    ? iconPath
    : path.resolve(process.cwd(), iconPath);

  if (!fs.existsSync(iconPath)) {
    console.error(`❌ Icon not found at: ${iconPath}`);
    process.exit(1);
  }
}

// --- Prepare Electron app folder ---
const appDir = path.join(process.cwd(), 'electron-app');
if (!fs.existsSync(appDir)) fs.mkdirSync(appDir);

// --- Write main.js ---
fs.writeFileSync(path.join(appDir, 'main.js'), `
const { app, BrowserWindow } = require('electron');
function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 800,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });
  win.loadURL('${url}');
}
app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
`);

// --- Write package.json ---
fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({
  name: "web2app-app",
  version: "1.0.0",
  main: "main.js"
}, null, 2));

// --- Build the app ---
console.log("📦 Installing Electron...");
try {
  execSync(`npm install --prefix "${appDir}" electron`, { stdio: 'inherit' });
} catch (e) {
  console.error("❌ Failed to install Electron.");
  process.exit(1);
}

console.log(`🚀 Building EXE as ${appName}...`);
const iconOption = iconPath ? `--icon="${iconPath}"` : '';
try {
  execSync(`npx electron-packager "${appDir}" "${appName}" --platform=win32 --arch=x64 ${iconOption} --overwrite`, { stdio: 'inherit' });
} catch (e) {
  console.error("❌ Failed to package Electron app.");
  process.exit(1);
}

console.log(`✅ App created: ${appName}-win32-x64`);
