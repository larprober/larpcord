/*
 * Larpcord, a Discord client mod
 * Copyright (c) 2026 Larpcord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Helpers shared by the Larpcord-only plugins. The plugin globber skips files
// that start with an underscore, so this is never loaded as a plugin itself.

import { sendBotMessage } from "@api/Commands";
import { NavigationRouter } from "@webpack/common";

export function reply(channelId: string, content: string) {
    sendBotMessage(channelId, {
        content,
        author: { username: "Larpcord" } as any
    });
}

export function messageUrl(guildId: string | null | undefined, channelId: string, messageId: string) {
    return `https://discord.com/channels/${guildId ?? "@me"}/${channelId}/${messageId}`;
}

export function jumpToMessage(guildId: string | null | undefined, channelId: string, messageId: string) {
    NavigationRouter.transitionTo(`/channels/${guildId ?? "@me"}/${channelId}/${messageId}`);
}

/** 3725 -> "1h 2m", 42 -> "42s" */
export function formatDuration(totalSeconds: number) {
    const s = Math.max(0, Math.round(totalSeconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h) return `${h}h ${m}m`;
    if (m) return `${m}m`;
    return `${s}s`;
}

/** Local calendar day as YYYY-MM-DD, used as a storage key. */
export function dayKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

/** Trim a message for display in a notification or list. */
export function snippet(text: string, max = 140) {
    const flat = text.replace(/\s+/g, " ").trim();
    return flat.length > max ? flat.slice(0, max - 1) + "…" : flat;
}

/**
 * Returns a function that is true the first time it sees an id and false after.
 * Discord can dispatch MESSAGE_CREATE more than once for the same message (for your
 * own messages: once from the send response and once from the gateway).
 */
export function firstSeen(limit = 500) {
    const seen = new Set<string>();
    return (id: string) => {
        if (seen.has(id)) return false;
        seen.add(id);
        if (seen.size > limit) seen.delete(seen.values().next().value!);
        return true;
    };
}

/** "HH:MM" -> minutes after midnight, or null when malformed. */
export function parseClock(value: string): number | null {
    const m = /^\s*(\d{1,2})[:.](\d{2})\s*$/.exec(value);
    if (!m) return null;
    const h = Number(m[1]), min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
}
