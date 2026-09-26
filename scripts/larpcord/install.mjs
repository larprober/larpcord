/*
 * Larpcord, a Discord client mod
 * Copyright (c) 2026 Larpcord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Points the Discord desktop app at this Larpcord build, or undoes that.
//
//   node scripts/larpcord/install.mjs              install into Discord Stable
//   node scripts/larpcord/install.mjs --uninstall  put back whatever was there before
//   add --ptb / --canary / --all for other Discord branches
//
// Discord must be closed while this runs. Windows only; on macOS and Linux use
// Vencord's installer with the dist folder from this repo.

import { execSync } from "child_process";
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PATCHER = join(REPO, "dist", "patcher.js");
const BACKUP = "app.asar.before-larpcord";
const MARKER = "larpcord-shim";

const args = new Set(process.argv.slice(2));
const uninstall = args.has("--uninstall");
const branches = args.has("--all") ? ["Discord", "DiscordPTB", "DiscordCanary"]
    : args.has("--ptb") ? ["DiscordPTB"]
        : args.has("--canary") ? ["DiscordCanary"]
            : ["Discord"];

if (process.platform !== "win32") {
    console.error("This script only knows the Windows Discord layout.");
    process.exit(1);
}

/** A minimal asar archive holding index.js + package.json, same shape Vencord's installer writes. */
function makeShim(patcherPath) {
    const files = {
        "index.js": `// ${MARKER}\nrequire(${JSON.stringify(patcherPath)});\n`,
        "package.json": JSON.stringify({ name: "discord", main: "index.js" }, null, 4)
    };
    let offset = 0;
    const entries = {};
    const bodies = [];
    for (const [name, text] of Object.entries(files)) {
        const buf = Buffer.from(text, "utf8");
        entries[name] = { size: buf.length, offset: String(offset) };
        offset += buf.length;
        bodies.push(buf);
    }
    const json = Buffer.from(JSON.stringify({ files: entries }), "utf8");
    const padded = Math.ceil(json.length / 4) * 4;

    // Chromium Pickle framing: [4][headerPickleSize] then [payloadSize][stringLength][string + padding]
    const head = Buffer.alloc(16 + padded);
    head.writeUInt32LE(4, 0);
    head.writeUInt32LE(8 + padded, 4);
    head.writeUInt32LE(4 + padded, 8);
    head.writeUInt32LE(json.length, 12);
    json.copy(head, 16);
    return Buffer.concat([head, ...bodies]);
}

function discordRunning(branch) {
    try {
        const out = execSync(`tasklist /FI "IMAGENAME eq ${branch}.exe" /NH`, { encoding: "utf8" });
        return out.toLowerCase().includes(`${branch.toLowerCase()}.exe`);
    } catch {
        return false;
    }
}

/** Newest app-x.y.z folder whose resources are complete (a half-downloaded update has none). */
function latestAppDir(base) {
    const versions = readdirSync(base)
        .filter(d => /^app-\d+\.\d+\.\d+$/.test(d))
        .filter(d => existsSync(join(base, d, "resources", "app.asar")) || existsSync(join(base, d, "resources", "_app.asar")))
        .sort((a, b) => {
            const pa = a.slice(4).split(".").map(Number), pb = b.slice(4).split(".").map(Number);
            for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
            return 0;
        });
    return versions.length ? join(base, versions.at(-1)) : null;
}

/** Mod loaders are a few hundred bytes; Discord's real app.asar is megabytes. */
function isLoader(path) {
    return existsSync(path) && statSync(path).size < 64 * 1024;
}

/** The file a loader require()s, or null. */
function loaderTarget(path) {
    const raw = /require\((".+?")\)/.exec(readFileSync(path, "utf8"))?.[1];
    try {
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function describeLoader(path) {
    const text = readFileSync(path).toString("latin1");
    if (text.includes(MARKER)) return "Larpcord";
    const target = loaderTarget(path);
    if (!target) return "unknown mod";
    return /vencord/i.test(target) ? `Vencord (${target})` : `mod (${target})`;
}

let failures = 0;
for (const branch of branches) {
    const base = join(process.env.LOCALAPPDATA, branch);
    if (!existsSync(base)) continue;

    if (discordRunning(branch)) {
        console.error(`${branch} is running. Quit it from the tray icon first, then run this again.`);
        failures++;
        continue;
    }

    const app = latestAppDir(base);
    if (!app) {
        console.error(`${branch}: couldn't find an installed version.`);
        failures++;
        continue;
    }
    const res = join(app, "resources");
    const appAsar = join(res, "app.asar");
    const original = join(res, "_app.asar");
    const backup = join(res, BACKUP);

    if (uninstall) {
        if (!existsSync(original) || !isLoader(appAsar) || describeLoader(appAsar) !== "Larpcord") {
            console.log(`${branch}: Larpcord isn't installed in ${app}, nothing to do.`);
            continue;
        }
        // Only bring the old mod back if its files still exist, or Discord would fail to start
        const backupTarget = existsSync(backup) ? loaderTarget(backup) : null;
        if (backupTarget && existsSync(backupTarget)) {
            renameSync(backup, appAsar + ".tmp");
            rmSync(appAsar);
            renameSync(appAsar + ".tmp", appAsar);
            console.log(`${branch}: restored ${describeLoader(appAsar)}.`);
        } else {
            if (backupTarget) console.log(`${branch}: the previous mod (${backupTarget}) is gone, so restoring plain Discord.`);
            if (existsSync(backup)) rmSync(backup);
            rmSync(appAsar);
            renameSync(original, appAsar);
            console.log(`${branch}: restored vanilla Discord.`);
        }
        continue;
    }

    if (!existsSync(PATCHER)) {
        console.error("dist/patcher.js is missing. Run `pnpm build` first.");
        process.exit(1);
    }

    if (isLoader(appAsar)) {
        // Already modded. Keep the previous loader so --uninstall can bring it back.
        if (!existsSync(original)) {
            console.error(`${branch}: found a mod loader but no _app.asar next to it. Reinstall Discord, then try again.`);
            failures++;
            continue;
        }
        const current = describeLoader(appAsar);
        if (current !== "Larpcord" && !existsSync(backup)) {
            renameSync(appAsar, backup);
            console.log(`${branch}: saved the existing ${current} loader to ${BACKUP}.`);
        }
    } else if (existsSync(appAsar)) {
        // Discord's real code. Discord's updater can put this back over a loader when it
        // reinstalls itself, so it's the freshest copy and any _app.asar is stale.
        if (existsSync(original)) rmSync(original);
        renameSync(appAsar, original);
    }
    writeFileSync(appAsar, makeShim(PATCHER));
    console.log(`${branch}: Larpcord installed into ${app}.`);
}

process.exit(failures ? 1 : 0);
