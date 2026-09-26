/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Settings } from "@api/Settings";
import { IpcEvents } from "@shared/IpcEvents";
import { SettingsStore } from "@shared/SettingsStore";
import { mergeDefaults } from "@utils/mergeDefaults";
import { ipcMain } from "electron";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

import { DATA_DIR, NATIVE_SETTINGS_FILE, SETTINGS_DIR, SETTINGS_FILE, THEMES_DIR, VENCORD_DATA_DIR } from "./utils/constants";

// First launch of Larpcord on a machine that already had Vencord: bring the
// user's plugin settings, QuickCSS and themes along instead of starting blank.
// Vencord's own folder is only read, never modified.
if (!existsSync(SETTINGS_FILE) && DATA_DIR !== VENCORD_DATA_DIR) {
    try {
        const oldSettings = join(VENCORD_DATA_DIR, "settings");
        const oldThemes = join(VENCORD_DATA_DIR, "themes");
        if (existsSync(join(oldSettings, "settings.json"))) {
            cpSync(oldSettings, SETTINGS_DIR, { recursive: true, force: false });
            if (existsSync(oldThemes)) cpSync(oldThemes, THEMES_DIR, { recursive: true, force: false });
            console.log("[Larpcord] Imported settings and themes from", VENCORD_DATA_DIR);
        }
    } catch (err) {
        console.error("[Larpcord] Could not import Vencord settings", err);
    }
}

mkdirSync(SETTINGS_DIR, { recursive: true });

function readSettings<T = object>(name: string, file: string): Partial<T> {
    try {
        return JSON.parse(readFileSync(file, "utf-8"));
    } catch (err: any) {
        if (err?.code !== "ENOENT")
            console.error(`Failed to read ${name} settings`, err);

        return {};
    }
}

export const RendererSettings = new SettingsStore(readSettings<Settings>("renderer", SETTINGS_FILE));

RendererSettings.addGlobalChangeListener(() => {
    try {
        writeFileSync(SETTINGS_FILE, JSON.stringify(RendererSettings.plain, null, 4));
    } catch (e) {
        console.error("Failed to write renderer settings", e);
    }
});

ipcMain.on(IpcEvents.GET_SETTINGS, e => e.returnValue = RendererSettings.plain);

ipcMain.handle(IpcEvents.SET_SETTINGS, (_, data: Settings, pathToNotify?: string) => {
    RendererSettings.setData(data, pathToNotify);
});

export interface NativeSettings {
    plugins: {
        [plugin: string]: {
            [setting: string]: any;
        };
    };
    customCspRules: Record<string, string[]>;
}

const DefaultNativeSettings: NativeSettings = {
    plugins: {},
    customCspRules: {}
};

const nativeSettings = readSettings<NativeSettings>("native", NATIVE_SETTINGS_FILE);
mergeDefaults(nativeSettings, DefaultNativeSettings);

export const NativeSettings = new SettingsStore(nativeSettings as NativeSettings);

NativeSettings.addGlobalChangeListener(() => {
    try {
        writeFileSync(NATIVE_SETTINGS_FILE, JSON.stringify(NativeSettings.plain, null, 4));
    } catch (e) {
        console.error("Failed to write native settings", e);
    }
});
