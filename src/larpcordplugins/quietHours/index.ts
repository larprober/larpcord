/*
 * Larpcord, a Discord client mod
 * Copyright (c) 2026 Larpcord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { getUserSettingLazy } from "@api/UserSettings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { showToast, Toasts } from "@webpack/common";

import { parseClock } from "../_lib";

const StatusSettings = getUserSettingLazy<string>("status", "status")!;

const settings = definePluginSettings({
    start: {
        type: OptionType.STRING,
        description: "Quiet hours start (24 hour clock, HH:MM)",
        default: "23:00",
        isValid: (v: string) => parseClock(v) !== null || "Use HH:MM, for example 23:00"
    },
    end: {
        type: OptionType.STRING,
        description: "Quiet hours end (24 hour clock, HH:MM)",
        default: "08:00",
        isValid: (v: string) => parseClock(v) !== null || "Use HH:MM, for example 08:00"
    },
    days: {
        type: OptionType.SELECT,
        description: "Which days (by the day quiet hours start on)",
        options: [
            { label: "Every day", value: "all", default: true },
            { label: "Weeknights (Sun to Thu)", value: "school" },
            { label: "Weekdays (Mon to Fri)", value: "weekdays" },
            { label: "Weekends (Sat and Sun)", value: "weekends" }
        ]
    },
    status: {
        type: OptionType.SELECT,
        description: "Status during quiet hours",
        options: [
            { label: "Do Not Disturb", value: "dnd", default: true },
            { label: "Idle", value: "idle" },
            { label: "Invisible", value: "invisible" }
        ]
    },
    announce: {
        type: OptionType.BOOLEAN,
        description: "Show a small toast when quiet hours begin or end",
        default: true
    },
    savedStatus: {
        type: OptionType.CUSTOM,
        // the status to put back when quiet hours end; survives restarts
        default: "" as string
    },
    appliedStatus: {
        type: OptionType.CUSTOM,
        default: "" as string
    }
});

const DAY_SETS: Record<string, number[]> = {
    all: [0, 1, 2, 3, 4, 5, 6],
    school: [0, 1, 2, 3, 4],
    weekdays: [1, 2, 3, 4, 5],
    weekends: [0, 6]
};

/** Is `now` inside a window that may wrap past midnight? The start day decides whether it counts. */
export function inQuietHours(now: Date, start: number, end: number, days: number[]) {
    const minute = now.getHours() * 60 + now.getMinutes();
    if (start === end) return false;
    if (start < end) return minute >= start && minute < end && days.includes(now.getDay());
    // wraps midnight: late part belongs to today, early part belongs to yesterday
    if (minute >= start) return days.includes(now.getDay());
    if (minute < end) return days.includes((now.getDay() + 6) % 7);
    return false;
}

let timer: ReturnType<typeof setInterval> | null = null;

async function tick() {
    const s = settings.store;
    const start = parseClock(s.start), end = parseClock(s.end);
    if (start === null || end === null) return;

    const quiet = inQuietHours(new Date(), start, end, DAY_SETS[s.days] ?? DAY_SETS.all);
    const current = StatusSettings.getSetting();

    if (quiet && !s.appliedStatus) {
        if (current === s.status || current === "invisible") return; // already quiet, leave it be
        s.savedStatus = current;
        s.appliedStatus = s.status;
        await StatusSettings.updateSetting(s.status);
        if (s.announce) showToast(`Quiet hours until ${s.end}`, Toasts.Type.MESSAGE);
    } else if (!quiet && s.appliedStatus) {
        // only restore if the user hasn't picked something else in the meantime
        if (current === s.appliedStatus && s.savedStatus) {
            await StatusSettings.updateSetting(s.savedStatus);
            if (s.announce) showToast("Quiet hours are over", Toasts.Type.MESSAGE);
        }
        s.appliedStatus = "";
        s.savedStatus = "";
    }
}

export default definePlugin({
    name: "QuietHours",
    description: "Switches you to Do Not Disturb (or idle / invisible) on a schedule, like every night from 23:00 to 08:00, and puts your old status back afterwards.",
    tags: ["Notifications", "Activity", "Utility"],
    authors: [Devs.Larpcord],
    settings,

    start() {
        tick();
        timer = setInterval(tick, 30_000);
    },

    stop() {
        if (timer) clearInterval(timer);
        timer = null;
    }
});
