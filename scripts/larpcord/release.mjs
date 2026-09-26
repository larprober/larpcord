/*
 * Larpcord, a Discord client mod
 * Copyright (c) 2026 Larpcord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Builds every download into ./release, plus the website in ./release/site:
//   LarpcordSetup.exe      Windows installer with the desktop mod embedded
//   larpcord.apk           Android app (needs ../larpcord-android and its signing key)
//   larpcord.user.js       browser userscript (Tampermonkey / Violentmonkey)
//   larpcord-source.zip    the complete source for all of the above, as the GPL requires
//   site/                  static website; upload the folder as-is (e.g. to GitHub Pages)
//
//   node scripts/larpcord/release.mjs [--skip-android]      (Windows only: needs csc.exe)

import { execFileSync, execSync } from "child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { createRequire } from "module";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ANDROID = resolve(REPO, "../larpcord-android");
const SETUP = join(REPO, "scripts/larpcord/windows/setup");
const OUT = join(REPO, "release");
const STAGE = join(OUT, ".stage");
const skipAndroid = process.argv.includes("--skip-android");
const Zip = createRequire(join(REPO, "package.json"))("zip-local");
const version = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).version;
const CSC = join(process.env.WINDIR ?? "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: REPO, stdio: "inherit", shell: process.platform === "win32", ...opts });
const zipDir = (dir, file) => Zip.sync.zip(dir).compress().save(file);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });

// ---- Windows installer ----
console.log("\n== desktop (standalone) build");
run("node", ["scripts/build/build.mjs", "--standalone"]);
const payload = join(STAGE, "payload");
mkdirSync(payload, { recursive: true });
for (const f of ["patcher.js", "preload.js", "renderer.js", "renderer.css"]) copyFileSync(join(REPO, "dist", f), join(payload, f));
writeFileSync(join(payload, "package.json"), "{}");
// Put the regular (repo) build back, since a local Discord may be loading dist/ directly.
run("node", ["scripts/build/build.mjs"]);

console.log("\n== LarpcordSetup.exe");
const icon = join(STAGE, "larpcord.ico");
execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(SETUP, "make-icon.ps1"), "-Out", icon], { stdio: "inherit" });
execFileSync(CSC, [
    "/nologo", "/target:winexe", "/optimize+",
    `/out:${join(OUT, "LarpcordSetup.exe")}`,
    `/win32icon:${icon}`,
    `/win32manifest:${join(SETUP, "app.manifest")}`,
    "/r:System.Windows.Forms.dll", "/r:System.Drawing.dll", "/r:System.Core.dll",
    ...readdirSync(payload).map(f => `/resource:${join(payload, f)},payload/${f}`),
    join(SETUP, "LarpcordSetup.cs")
], { stdio: "inherit" });
console.log("wrote LarpcordSetup.exe");

// ---- web / userscript ----
console.log("\n== web build");
run("node", ["scripts/build/buildWeb.mjs"]);
copyFileSync(join(REPO, "dist/Vencord.user.js"), join(OUT, "larpcord.user.js"));

// ---- Android ----
if (!skipAndroid) {
    console.log("\n== android build");
    copyFileSync(join(REPO, "dist/Vencord.user.js"), join(ANDROID, "app/src/main/assets/larpcord.user.js"));
    const env = { ...process.env, JAVA_TOOL_OPTIONS: `-Djdk.net.unixdomain.tmpdir=${join(process.env.USERPROFILE ?? "", ".gradle", "udtmp")}` };
    mkdirSync(join(process.env.USERPROFILE ?? "", ".gradle", "udtmp"), { recursive: true });
    // quoted full path: cmd.exe won't always look in the working directory, and the path has spaces
    const gradlew = process.platform === "win32" ? `"${join(ANDROID, "gradlew.bat")}"` : "./gradlew";
    run(gradlew, ["--no-daemon", "assembleRelease"], { cwd: ANDROID, env });
    copyFileSync(join(ANDROID, "app/build/outputs/apk/release/app-release.apk"), join(OUT, "larpcord.apk"));
    console.log("wrote larpcord.apk");
}

// ---- source ----
console.log("\n== source");
const src = join(STAGE, "source");
const listed = execSync("git ls-files --cached --others --exclude-standard", { cwd: REPO, encoding: "utf8" })
    .split("\n").map(s => s.trim()).filter(Boolean)
    .filter(f => existsSync(join(REPO, f)) && !f.startsWith("release/"));
for (const f of listed) {
    mkdirSync(dirname(join(src, "larpcord", f)), { recursive: true });
    copyFileSync(join(REPO, f), join(src, "larpcord", f));
}
if (existsSync(ANDROID)) {
    // Everything except build output and the private signing material.
    const skip = /^(build|app[\\/]build|\.gradle|\.kotlin|keystore|keystore\.properties|local\.properties)([\\/]|$)/;
    cpSync(ANDROID, join(src, "larpcord-android"), {
        recursive: true,
        filter: p => !skip.test(p.slice(ANDROID.length + 1))
    });
}
zipDir(src, join(OUT, "larpcord-source.zip"));
console.log("wrote larpcord-source.zip");

// ---- website ----
function pluginNames() {
    // what people see in Settings: no internal API/required/hidden plugins, no web-only ones,
    // and not the Larpcord originals, which the page lists separately
    const out = [];
    const dir = join(REPO, "src/plugins");
    for (const d of readdirSync(dir, { withFileTypes: true })) {
        if (d.name.startsWith("_") || d.name.startsWith(".") || /\.(web|browser|vesktop|dev)$/.test(d.name)) continue;
        const file = d.isDirectory() ? ["index.ts", "index.tsx"].map(x => join(dir, d.name, x)).find(existsSync) : join(dir, d.name);
        if (!file) continue;
        const text = readFileSync(file, "utf8");
        const m = /definePlugin\(\{\s*name:\s*"([^"]+)"/.exec(text);
        if (!m || m[1].endsWith("API")) continue;
        if (/\n\s*(required|hidden):\s*true/.test(text.slice(m.index, m.index + 4000))) continue;
        out.push(m[1]);
    }
    return out.sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
}

console.log("\n== website");
const site = join(OUT, "site");
cpSync(join(REPO, "site"), site, { recursive: true });
mkdirSync(join(site, "downloads"), { recursive: true });
for (const f of ["LarpcordSetup.exe", "larpcord.apk", "larpcord.user.js", "larpcord-source.zip"]) {
    if (existsSync(join(OUT, f))) copyFileSync(join(OUT, f), join(site, "downloads", f));
}
// A real screenshot of the installer for the page, in the state most people will see:
// a stock Discord found and Install ready. A stand-in Discord folder keeps it independent of this PC.
const shotRes = join(STAGE, "shot", "Discord", "app-1.0.9259", "resources");
mkdirSync(shotRes, { recursive: true });
writeFileSync(join(shotRes, "app.asar"), Buffer.alloc(200 * 1024));
execFileSync(join(OUT, "LarpcordSetup.exe"), ["--render", join(site, "installer.png"), "--discord-root", join(STAGE, "shot")]);

// Fill in what the page shows as plain text, so nothing appears after load.
const sizeOf = f => {
    const p = join(site, "downloads", f);
    if (!existsSync(p)) return null;
    const bytes = statSync(p).size;
    return bytes > 1048576 ? (bytes / 1048576).toFixed(1) + " MB" : Math.round(bytes / 1024) + " KB";
};
const names = pluginNames();
const page = readFileSync(join(site, "index.html"), "utf8")
    .replaceAll("__VERSION__", version)
    .replaceAll("__PLUGIN_COUNT__", String(names.length))
    .replaceAll("__TOTAL_COUNT__", String(names.length + readdirSync(join(REPO, "src/larpcordplugins")).filter(n => !n.startsWith("_")).length))
    .replace("__PLUGIN_LIST__", names.map(n => `        <li>${n}</li>`).join("\n"))
    .replace(/(<small data-size="([^"]+)">)([^<]*)(<\/small>)/g, (_, open, file, label, close) =>
        open + label + (sizeOf(file) ? " · " + sizeOf(file) : "") + close);
writeFileSync(join(site, "index.html"), page);
console.log("wrote site/ (upload the folder as-is, e.g. to a GitHub Pages repo)");

rmSync(STAGE, { recursive: true, force: true });
console.log(`\nLarpcord ${version}: release files are in ${OUT}`);
