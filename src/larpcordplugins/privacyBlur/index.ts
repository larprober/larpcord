/*
 * Larpcord, a Discord client mod
 * Copyright (c) 2026 Larpcord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";

const settings = definePluginSettings({
    whenUnfocused: {
        type: OptionType.BOOLEAN,
        description: "Blur Discord when you switch to another window",
        default: true
    },
    idleMinutes: {
        type: OptionType.NUMBER,
        description: "Also blur after this many minutes without mouse or keyboard input (0 turns it off)",
        default: 0
    },
    hotkey: {
        type: OptionType.STRING,
        description: "Shortcut that blurs or unblurs right away",
        default: "Ctrl+Shift+L"
    },
    strength: {
        type: OptionType.SLIDER,
        description: "Blur strength",
        markers: [4, 8, 12, 16, 24, 32],
        default: 16,
        stickToMarkers: false,
        onChange: (v: number) => document.documentElement.style.setProperty("--lc-privacy-blur", `${v}px`)
    },
    scope: {
        type: OptionType.SELECT,
        description: "What to hide",
        options: [
            { label: "The whole window", value: "all", default: true },
            { label: "Only messages and the member list", value: "content" }
        ]
    }
});

type Reason = "unfocused" | "idle" | "manual";
const reasons = new Set<Reason>();
let overlay: HTMLDivElement | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function render() {
    const root = document.documentElement;
    const on = reasons.size > 0;
    root.classList.toggle("lc-privacy-on", on);
    root.dataset.lcPrivacyScope = settings.store.scope;

    if (on && !overlay) {
        overlay = document.createElement("div");
        overlay.className = "lc-privacy-overlay";
        overlay.innerHTML = "<div class=\"lc-privacy-card\"><strong>Hidden</strong><span></span></div>";
        overlay.addEventListener("click", () => {
            reasons.delete("manual");
            reasons.delete("idle");
            render();
        });
        document.body.appendChild(overlay);
    }
    if (overlay) {
        overlay.hidden = !on;
        const hint = overlay.querySelector("span")!;
        hint.textContent = reasons.has("unfocused") && reasons.size === 1
            ? "Come back to this window to reveal"
            : `Click or press ${settings.store.hotkey} to reveal`;
    }
}

function set(reason: Reason, on: boolean) {
    if (on) reasons.add(reason);
    else reasons.delete(reason);
    render();
}

export function matchesHotkey(e: KeyboardEvent, combo: string) {
    const parts = combo.toLowerCase().split("+").map(p => p.trim()).filter(Boolean);
    const key = parts.pop();
    if (!key) return false;
    const wants = new Set(parts);
    const ctrl = wants.has("ctrl") || wants.has("control");
    const meta = wants.has("meta") || wants.has("cmd") || wants.has("win");
    return e.ctrlKey === ctrl
        && e.shiftKey === wants.has("shift")
        && e.altKey === wants.has("alt")
        && e.metaKey === meta
        && (e.key.toLowerCase() === key || e.code.toLowerCase() === `key${key}` || e.code.toLowerCase() === key);
}

function onKeyDown(e: KeyboardEvent) {
    if (!matchesHotkey(e, settings.store.hotkey)) return;
    e.preventDefault();
    e.stopPropagation();
    if (reasons.size) {
        reasons.clear();
        render();
    } else set("manual", true);
}

function resetIdle() {
    if (idleTimer) clearTimeout(idleTimer);
    if (reasons.has("idle")) set("idle", false);
    const minutes = settings.store.idleMinutes;
    if (minutes > 0) idleTimer = setTimeout(() => set("idle", true), minutes * 60_000);
}

function onBlur() {
    if (!settings.store.whenUnfocused) return;
    // Clicking into an embedded video moves focus to an iframe, which isn't leaving Discord
    setTimeout(() => {
        if (document.hasFocus() || document.activeElement?.tagName === "IFRAME") return;
        set("unfocused", true);
    }, 0);
}

function onFocus() {
    set("unfocused", false);
}

const activityEvents = ["mousemove", "mousedown", "keydown", "wheel", "touchstart"] as const;

export default definePlugin({
    name: "PrivacyBlur",
    description: "Blurs Discord when you tab away, after you go idle, or on a hotkey, so people looking at your screen can't read your chats.",
    tags: ["Privacy", "Shortcuts", "Appearance"],
    authors: [Devs.Larpcord],
    settings,

    start() {
        document.documentElement.style.setProperty("--lc-privacy-blur", `${settings.store.strength}px`);
        window.addEventListener("blur", onBlur);
        window.addEventListener("focus", onFocus);
        document.addEventListener("keydown", onKeyDown, true);
        for (const ev of activityEvents) document.addEventListener(ev, resetIdle, { passive: true, capture: true });
        resetIdle();
    },

    stop() {
        window.removeEventListener("blur", onBlur);
        window.removeEventListener("focus", onFocus);
        document.removeEventListener("keydown", onKeyDown, true);
        for (const ev of activityEvents) document.removeEventListener(ev, resetIdle, { capture: true });
        if (idleTimer) clearTimeout(idleTimer);
        reasons.clear();
        render();
        overlay?.remove();
        overlay = null;
        document.documentElement.classList.remove("lc-privacy-on");
    }
});
