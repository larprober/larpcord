/*
 * Larpcord, a Discord client mod
 * Copyright (c) 2026 Larpcord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType } from "@api/Commands";
import * as DataStore from "@api/DataStore";
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { SelectedChannelStore, UserStore } from "@webpack/common";

import { dayKey, firstSeen, formatDuration, reply } from "../_lib";

const STORE_KEY = "Larpcord_SessionStats";
const KEEP_DAYS = 90;
const TICK_MS = 15_000;
/** Longer gaps than this mean the PC slept; don't count them. */
const MAX_GAP_MS = 60_000;
/** You count as active if you touched Discord within this window while it had focus. */
const ACTIVE_WINDOW_MS = 3 * 60_000;

interface Day {
    open: number;
    active: number;
    voice: number;
    messages: number;
    limitNotified?: boolean;
}

type History = Record<string, Day>;

const settings = definePluginSettings({
    dailyLimit: {
        type: OptionType.NUMBER,
        description: "Remind me once a day after this many minutes of active use (0 turns it off)",
        default: 0
    }
});

let history: History = {};
let loaded = false;
let lastTick = Date.now();
let lastInput = Date.now();
let lastSave = 0;
let timer: ReturnType<typeof setInterval> | null = null;

const isNewMessage = firstSeen();

const blankDay = (): Day => ({ open: 0, active: 0, voice: 0, messages: 0 });

function today() {
    const key = dayKey();
    return history[key] ??= blankDay();
}

async function save(force = false) {
    if (!loaded || (!force && Date.now() - lastSave < 60_000)) return;
    lastSave = Date.now();
    const keys = Object.keys(history).sort();
    for (const old of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete history[old];
    await DataStore.set(STORE_KEY, history);
}

function tick() {
    const now = Date.now();
    const gap = now - lastTick;
    lastTick = now;
    if (!loaded || gap > MAX_GAP_MS) return;

    const seconds = gap / 1000;
    const day = today();
    day.open += seconds;
    if (document.hasFocus() && now - lastInput < ACTIVE_WINDOW_MS) day.active += seconds;
    if (SelectedChannelStore.getVoiceChannelId()) day.voice += seconds;

    const limit = settings.store.dailyLimit;
    if (limit > 0 && !day.limitNotified && day.active >= limit * 60) {
        day.limitNotified = true;
        showNotification({
            title: "Time check",
            body: `You've been active on Discord for ${formatDuration(day.active)} today, past the ${formatDuration(limit * 60)} you set.`
        });
        save(true);
    }

    save();
}

const markInput = () => { lastInput = Date.now(); };
const inputEvents = ["keydown", "mousedown", "wheel", "mousemove"] as const;

const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short" });

export function renderStats(hist: History, now = new Date()) {
    const days: { label: string; day: Day; }[] = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        days.push({ label: i === 0 ? "Today" : WEEKDAY.format(d), day: hist[dayKey(d)] ?? blankDay() });
    }

    const t = days[days.length - 1].day;
    const max = Math.max(1, ...days.map(d => d.day.active));
    const bars = days.map(({ label, day }) => {
        const width = Math.round((day.active / max) * 20);
        return `${label.padEnd(5)} ${"█".repeat(width)}${"░".repeat(20 - width)} ${formatDuration(day.active)}`;
    });

    const week = days.reduce((acc, { day }) => ({
        active: acc.active + day.active,
        messages: acc.messages + day.messages,
        voice: acc.voice + day.voice
    }), { active: 0, messages: 0, voice: 0 });

    return [
        `**Today:** ${formatDuration(t.active)} active (${formatDuration(t.open)} open), ${t.messages} message${t.messages === 1 ? "" : "s"} sent, ${formatDuration(t.voice)} in voice`,
        "```",
        ...bars,
        "```",
        `**Last 7 days:** ${formatDuration(week.active)} active, ${week.messages} messages, ${formatDuration(week.voice)} in voice`
    ].join("\n");
}

export default definePlugin({
    name: "SessionStats",
    description: "Screen time for Discord: how long you've actively used it, time in voice and messages sent, per day. /stats shows the last week, and you can set a daily reminder.",
    tags: ["Utility", "Activity"],
    authors: [Devs.Larpcord],
    enabledByDefault: true,
    settings,

    flux: {
        MESSAGE_CREATE({ message, optimistic }: { message: any; optimistic: boolean; }) {
            if (optimistic || !loaded || !message?.id) return;
            if (message.author?.id === UserStore.getCurrentUser()?.id && isNewMessage(message.id)) today().messages++;
        }
    },

    async start() {
        const stored = await DataStore.get<History>(STORE_KEY);
        // merge in case something was counted before the load finished
        history = { ...(stored ?? {}), ...history };
        loaded = true;
        lastTick = lastInput = Date.now();
        for (const ev of inputEvents) document.addEventListener(ev, markInput, { passive: true, capture: true });
        window.addEventListener("beforeunload", onUnload);
        timer = setInterval(tick, TICK_MS);
    },

    stop() {
        if (timer) clearInterval(timer);
        timer = null;
        for (const ev of inputEvents) document.removeEventListener(ev, markInput, { capture: true });
        window.removeEventListener("beforeunload", onUnload);
        save(true);
    },

    commands: [{
        name: "stats",
        description: "Your Discord screen time for the last week",
        inputType: ApplicationCommandInputType.BUILT_IN,
        execute(_, ctx) {
            tick();
            reply(ctx.channel.id, renderStats(history));
        }
    }]
});

function onUnload() {
    tick();
    save(true);
}
