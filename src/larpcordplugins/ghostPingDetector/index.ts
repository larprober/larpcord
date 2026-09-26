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
import { ChannelStore, GuildMemberStore, GuildStore, UserStore } from "@webpack/common";

import { jumpToMessage, reply, snippet } from "../_lib";

const LOG_KEY = "Larpcord_GhostPings";
const MAX_LOG = 50;

interface TrackedPing {
    id: string;
    channelId: string;
    guildId: string | null;
    authorName: string;
    authorId: string;
    avatar?: string;
    content: string;
    reason: string;
    at: number;
}

interface LoggedGhostPing extends TrackedPing {
    kind: "deleted" | "edited";
    caughtAt: number;
}

const settings = definePluginSettings({
    windowMinutes: {
        type: OptionType.SLIDER,
        description: "Count it as a ghost ping if the message disappears within this many minutes",
        markers: [1, 5, 10, 15, 30, 60],
        default: 10,
        stickToMarkers: false
    },
    everyoneAndRoles: {
        type: OptionType.BOOLEAN,
        description: "Also catch @everyone, @here and role pings, not just pings of you",
        default: false
    },
    catchEdits: {
        type: OptionType.BOOLEAN,
        description: "Also catch messages edited to remove the ping",
        default: true
    },
    ignoreBots: {
        type: OptionType.BOOLEAN,
        description: "Ignore bots (they often delete their own command replies)",
        default: true
    }
});

const tracked = new Map<string, TrackedPing>();

function pingReason(message: any, myId: string): string | null {
    if (message.mentions?.some((u: any) => (u?.id ?? u) === myId)) return "mentioned you";
    if (!settings.store.everyoneAndRoles) return null;
    if (message.mention_everyone) return "@everyone / @here";
    const guildId = message.guild_id ?? ChannelStore.getChannel(message.channel_id)?.guild_id;
    if (guildId && message.mention_roles?.length) {
        const myRoles = GuildMemberStore.getMember(guildId, myId)?.roles ?? [];
        if (message.mention_roles.some((r: string) => myRoles.includes(r))) return "mentioned your role";
    }
    return null;
}

function prune() {
    const cutoff = Date.now() - settings.store.windowMinutes * 60_000;
    for (const [id, ping] of tracked) {
        if (ping.at < cutoff) tracked.delete(id);
    }
}

async function caught(ping: TrackedPing, kind: LoggedGhostPing["kind"]) {
    tracked.delete(ping.id);

    const channel = ChannelStore.getChannel(ping.channelId);
    const guild = ping.guildId ? GuildStore.getGuild(ping.guildId) : null;
    const where = channel?.name ? `#${channel.name}${guild ? ` (${guild.name})` : ""}` : "a DM";
    const seconds = Math.round((Date.now() - ping.at) / 1000);

    showNotification({
        title: `Ghost ping from ${ping.authorName}`,
        body: `${kind === "deleted" ? "Deleted" : "Edited out"} ${seconds < 90 ? `${seconds}s` : `${Math.round(seconds / 60)} min`} later in ${where}: ${ping.content ? snippet(ping.content) : "(no text)"}`,
        icon: ping.avatar,
        permanent: false,
        onClick: () => jumpToMessage(ping.guildId, ping.channelId, ping.id)
    });

    await DataStore.update<LoggedGhostPing[]>(LOG_KEY, log =>
        [{ ...ping, kind, caughtAt: Date.now() }, ...(log ?? [])].slice(0, MAX_LOG)
    );
}

export default definePlugin({
    name: "GhostPingDetector",
    description: "Tells you who pinged you and then deleted or edited the message to hide it, and what it said. See past ones with /ghostpings.",
    tags: ["Notifications", "Privacy"],
    authors: [Devs.Larpcord],
    enabledByDefault: true,
    settings,

    flux: {
        MESSAGE_CREATE({ message, optimistic }: { message: any; optimistic: boolean; }) {
            if (optimistic || !message?.id) return;
            const me = UserStore.getCurrentUser();
            if (!me || message.author?.id === me.id) return;
            if (settings.store.ignoreBots && (message.author?.bot || message.webhook_id)) return;

            const reason = pingReason(message, me.id);
            if (!reason) return;

            prune();
            tracked.set(message.id, {
                id: message.id,
                channelId: message.channel_id,
                guildId: message.guild_id ?? ChannelStore.getChannel(message.channel_id)?.guild_id ?? null,
                authorId: message.author.id,
                authorName: message.member?.nick ?? message.author.global_name ?? message.author.username,
                avatar: message.author.avatar ? `https://cdn.discordapp.com/avatars/${message.author.id}/${message.author.avatar}.png?size=128` : undefined,
                content: message.content ?? "",
                reason,
                at: Date.now()
            });
        },

        MESSAGE_UPDATE({ message }: { message: any; }) {
            if (!settings.store.catchEdits || !message?.id) return;
            const ping = tracked.get(message.id);
            if (!ping) return;
            // embed-only updates arrive without content, those aren't edits
            if (message.content === undefined) return;

            const me = UserStore.getCurrentUser();
            if (!pingReason(message, me.id)) caught(ping, "edited");
        },

        MESSAGE_DELETE({ id, mlDeleted }: { id: string; mlDeleted?: boolean; }) {
            // MessageLogger re-dispatches deletes when you dismiss a logged message
            if (mlDeleted) return;
            const ping = tracked.get(id);
            if (ping && Date.now() - ping.at <= settings.store.windowMinutes * 60_000) caught(ping, "deleted");
        },

        MESSAGE_DELETE_BULK({ ids }: { ids: string[]; }) {
            for (const id of ids ?? []) {
                const ping = tracked.get(id);
                if (ping && Date.now() - ping.at <= settings.store.windowMinutes * 60_000) caught(ping, "deleted");
            }
        }
    },

    stop() {
        tracked.clear();
    },

    commands: [{
        name: "ghostpings",
        description: "Show recent ghost pings",
        inputType: ApplicationCommandInputType.BUILT_IN,
        async execute(_, ctx) {
            const log = (await DataStore.get<LoggedGhostPing[]>(LOG_KEY)) ?? [];
            if (!log.length) {
                reply(ctx.channel.id, "No ghost pings caught yet.");
                return;
            }
            const lines = log.slice(0, 10).map(p => {
                const channel = ChannelStore.getChannel(p.channelId);
                const where = channel?.name ? `<#${p.channelId}>` : "a DM";
                return `<t:${Math.floor(p.at / 1000)}:R> **${p.authorName}** (<@${p.authorId}>) in ${where}, ${p.kind}: ${p.content ? snippet(p.content, 90) : "(no text)"}`;
            });
            reply(ctx.channel.id, `Recent ghost pings:\n${lines.join("\n")}`.slice(0, 2000));
        }
    }]
});
