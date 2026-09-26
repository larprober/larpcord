/*
 * Larpcord, a Discord client mod
 * Copyright (c) 2026 Larpcord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption } from "@api/Commands";
import * as DataStore from "@api/DataStore";
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, GuildStore, SelectedChannelStore, UserGuildSettingsStore, UserStore } from "@webpack/common";

import { firstSeen, jumpToMessage, messageUrl, reply, snippet } from "../_lib";

const isNewMessage = firstSeen();

const HITS_KEY = "Larpcord_KeywordHits";
const MAX_HITS = 100;

interface Hit {
    keyword: string;
    guildId: string | null;
    channelId: string;
    messageId: string;
    author: string;
    content: string;
    at: number;
}

const settings = definePluginSettings({
    keywords: {
        type: OptionType.STRING,
        description: "One per line. Wrap in slashes for a regular expression, like /raid (tonight|now)/i",
        default: "",
        multiline: true
    },
    wholeWord: {
        type: OptionType.BOOLEAN,
        description: "Only match whole words, so \"art\" doesn't fire on \"party\"",
        default: true
    },
    caseSensitive: {
        type: OptionType.BOOLEAN,
        description: "Match upper and lower case exactly",
        default: false
    },
    watchDMs: {
        type: OptionType.BOOLEAN,
        description: "Also watch DMs and group DMs (they already notify you by default)",
        default: false
    },
    includeBots: {
        type: OptionType.BOOLEAN,
        description: "Also alert on messages sent by bots and webhooks",
        default: false
    },
    skipMuted: {
        type: OptionType.BOOLEAN,
        description: "Ignore servers and channels you've muted",
        default: false
    },
    skipOpenChannel: {
        type: OptionType.BOOLEAN,
        description: "Don't alert for the channel you're currently looking at",
        default: true
    }
});

interface Matcher { label: string; re: RegExp; }

let cacheKey = "";
let matchers: Matcher[] = [];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function buildMatchers(raw: string, wholeWord: boolean, caseSensitive: boolean): Matcher[] {
    const out: Matcher[] = [];
    for (const line of raw.split("\n").map(l => l.trim()).filter(Boolean)) {
        const re = /^\/(.+)\/([a-z]*)$/.exec(line);
        try {
            if (re) {
                out.push({ label: line, re: new RegExp(re[1], re[2].replace(/[gy]/g, "")) });
            } else {
                const body = escapeRe(line);
                // \b only works next to word characters, so fall back to whitespace boundaries for things like "c++"
                const pattern = wholeWord ? `(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])` : body;
                out.push({ label: line, re: new RegExp(pattern, caseSensitive ? "u" : "iu") });
            }
        } catch {
            // an invalid regex in the list shouldn't break the others
        }
    }
    return out;
}

function getMatchers() {
    const { keywords, wholeWord, caseSensitive } = settings.store;
    const key = `${keywords}\u0000${wholeWord}\u0000${caseSensitive}`;
    if (key !== cacheKey) {
        cacheKey = key;
        matchers = buildMatchers(keywords, wholeWord, caseSensitive);
    }
    return matchers;
}

function keywordLines() {
    return settings.store.keywords.split("\n").map(l => l.trim()).filter(Boolean);
}

async function logHit(hit: Hit) {
    await DataStore.update<Hit[]>(HITS_KEY, hits => [hit, ...(hits ?? [])].slice(0, MAX_HITS));
}

function avatarUrl(author: any) {
    return author?.avatar
        ? `https://cdn.discordapp.com/avatars/${author.id}/${author.avatar}.png?size=128`
        : undefined;
}

export default definePlugin({
    name: "KeywordAlerts",
    description: "Get a notification whenever a word or pattern you care about is mentioned in any server, even in channels you don't have open. Keeps a log you can check with /keywords hits.",
    tags: ["Notifications", "Utility"],
    authors: [Devs.Larpcord],
    settings,

    flux: {
        MESSAGE_CREATE({ message, optimistic }: { message: any; optimistic: boolean; }) {
            if (optimistic || !message?.content || !message.id) return;

            const me = UserStore.getCurrentUser();
            if (!me || message.author?.id === me.id) return;

            const s = settings.store;
            if (!s.includeBots && (message.author?.bot || message.webhook_id)) return;

            const channel = ChannelStore.getChannel(message.channel_id);
            const guildId: string | null = message.guild_id ?? channel?.guild_id ?? null;
            if (!guildId && !s.watchDMs) return;

            if (s.skipMuted && guildId && (UserGuildSettingsStore.isMuted(guildId) || UserGuildSettingsStore.isChannelMuted(guildId, message.channel_id))) return;
            if (s.skipOpenChannel && document.hasFocus() && SelectedChannelStore.getChannelId() === message.channel_id) return;

            const hit = getMatchers().find(m => m.re.test(message.content));
            if (!hit || !isNewMessage(message.id)) return;

            const guild = guildId ? GuildStore.getGuild(guildId) : null;
            const where = channel?.name
                ? `#${channel.name}${guild ? ` in ${guild.name}` : ""}`
                : "a DM";
            const authorName = message.member?.nick ?? message.author?.global_name ?? message.author?.username ?? "Someone";

            showNotification({
                title: `"${hit.label}" in ${where}`,
                body: `${authorName}: ${snippet(message.content)}`,
                icon: avatarUrl(message.author),
                onClick: () => jumpToMessage(guildId, message.channel_id, message.id)
            });

            logHit({
                keyword: hit.label,
                guildId,
                channelId: message.channel_id,
                messageId: message.id,
                author: authorName,
                content: snippet(message.content, 200),
                at: Date.now()
            });
        }
    },

    commands: [{
        name: "keywords",
        description: "Keyword Alerts",
        inputType: ApplicationCommandInputType.BUILT_IN,
        options: [
            {
                name: "add",
                description: "Start watching a word or /regex/",
                type: ApplicationCommandOptionType.SUB_COMMAND,
                options: [{ name: "keyword", description: "Word, phrase or /regex/flags", type: ApplicationCommandOptionType.STRING, required: true }]
            },
            {
                name: "remove",
                description: "Stop watching a keyword",
                type: ApplicationCommandOptionType.SUB_COMMAND,
                options: [{ name: "keyword", description: "Exactly as it appears in /keywords list", type: ApplicationCommandOptionType.STRING, required: true }]
            },
            {
                name: "list",
                description: "Show what you're watching",
                type: ApplicationCommandOptionType.SUB_COMMAND,
                options: []
            },
            {
                name: "hits",
                description: "Show recent matches with links",
                type: ApplicationCommandOptionType.SUB_COMMAND,
                options: []
            }
        ],
        async execute(args, ctx) {
            const sub = args[0];
            const channelId = ctx.channel.id;
            const keyword = findOption<string>(sub.options ?? [], "keyword", "").trim();

            switch (sub.name) {
                case "add": {
                    if (!keyword) return;
                    const lines = keywordLines();
                    if (lines.includes(keyword)) {
                        reply(channelId, `Already watching \`${keyword}\`.`);
                        return;
                    }
                    if (buildMatchers(keyword, true, false).length === 0) {
                        reply(channelId, `\`${keyword}\` isn't a valid regular expression.`);
                        return;
                    }
                    settings.store.keywords = [...lines, keyword].join("\n");
                    reply(channelId, `Watching \`${keyword}\`. You'll get a notification when it comes up.`);
                    return;
                }
                case "remove": {
                    const lines = keywordLines();
                    if (!lines.includes(keyword)) {
                        reply(channelId, `\`${keyword}\` isn't on your list.`);
                        return;
                    }
                    settings.store.keywords = lines.filter(l => l !== keyword).join("\n");
                    reply(channelId, `Stopped watching \`${keyword}\`.`);
                    return;
                }
                case "list": {
                    const lines = keywordLines();
                    reply(channelId, lines.length
                        ? `Watching ${lines.length} keyword${lines.length === 1 ? "" : "s"}:\n${lines.map(l => `\`${l}\``).join(", ")}`
                        : "You're not watching any keywords yet. Add one with `/keywords add`.");
                    return;
                }
                case "hits": {
                    const hits = (await DataStore.get<Hit[]>(HITS_KEY)) ?? [];
                    if (!hits.length) {
                        reply(channelId, "No keyword matches yet.");
                        return;
                    }
                    const lines = hits.slice(0, 12).map(h =>
                        `<t:${Math.floor(h.at / 1000)}:R> \`${h.keyword}\` ${h.author}: ${h.content.slice(0, 80)} ${messageUrl(h.guildId, h.channelId, h.messageId)}`
                    );
                    reply(channelId, `Recent matches:\n${lines.join("\n")}`.slice(0, 2000));
                    return;
                }
            }
        }
    }]
});
