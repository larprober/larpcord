/*
 * Larpcord, a Discord client mod
 * Copyright (c) 2026 Larpcord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { copyWithToast, insertTextIntoChatInputBox } from "@utils/discord";
import definePlugin, { OptionType } from "@utils/types";
import type { Message } from "@vencord/discord-types";
import { ChannelStore, Menu } from "@webpack/common";

import { messageUrl } from "../_lib";

const settings = definePluginSettings({
    attribution: {
        type: OptionType.SELECT,
        description: "What to put under the quote",
        options: [
            { label: "Author name linked to the original message", value: "link", default: true },
            { label: "Author name only", value: "name" },
            { label: "Mention the author (pings them)", value: "mention" },
            { label: "Nothing", value: "none" }
        ]
    }
});

/** If the user highlighted part of this message before right-clicking, quote just that part. */
function selectedTextIn(message: Message) {
    const selection = window.getSelection();
    const text = selection?.toString().trim();
    if (!selection || !text) return null;
    const el = document.getElementById(`chat-messages-${message.channel_id}-${message.id}`);
    if (!el || !selection.anchorNode || !el.contains(selection.anchorNode)) return null;
    return text;
}

export function buildQuote(content: string, author: { id: string; name: string; }, url: string, mode: string) {
    const body = content.length > 1500 ? content.slice(0, 1499) + "…" : content;
    const lines = body.split("\n").map(l => `> ${l}`);

    switch (mode) {
        case "link": lines.push(`> -# [${author.name.replace(/[[\]]/g, "")}](<${url}>)`); break;
        case "name": lines.push(`> -# ${author.name}`); break;
        case "mention": lines.push(`> -# <@${author.id}>`); break;
    }
    return lines.join("\n") + "\n";
}

function quoteFor(message: Message) {
    let content = selectedTextIn(message) ?? message.content ?? "";
    if (!content.trim()) {
        const file = message.attachments?.[0];
        content = file ? `[${file.filename}]` : message.embeds?.[0]?.rawTitle ?? "(no text)";
    }

    const guildId = ChannelStore.getChannel(message.channel_id)?.guild_id;
    const author = message.author as any;
    return buildQuote(
        content,
        { id: author.id, name: author.globalName ?? author.username },
        messageUrl(guildId, message.channel_id, message.id),
        settings.store.attribution
    );
}

const messageContextPatch: NavContextMenuPatchCallback = (children, { message }: { message?: Message; }) => {
    if (!message) return;

    children.push(
        <Menu.MenuGroup>
            <Menu.MenuItem
                id="lc-quote"
                label="Quote"
                action={() => insertTextIntoChatInputBox(quoteFor(message))}
            />
            <Menu.MenuItem
                id="lc-copy-quote"
                label="Copy as quote"
                action={() => copyWithToast(quoteFor(message), "Quote copied")}
            />
        </Menu.MenuGroup>
    );
};

export default definePlugin({
    name: "QuoteTools",
    description: "Adds Quote and Copy as quote to the message menu. Highlight part of a message first to quote just that bit. Works across channels and servers.",
    tags: ["Chat", "Utility"],
    authors: [Devs.Larpcord],
    enabledByDefault: true,
    settings,

    contextMenus: {
        "message": messageContextPatch
    }
});
