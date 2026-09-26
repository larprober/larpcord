/*
 * Larpcord, a Discord client mod
 * Copyright (c) 2026 Larpcord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption } from "@api/Commands";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { Flex } from "@components/Flex";
import { HeadingSecondary } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { Devs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import definePlugin, { IconComponent, OptionType } from "@utils/types";
import { RenderModalProps } from "@vencord/discord-types";
import { ContextMenuApi, Menu, Modal, openModal, TextInput, useState } from "@webpack/common";

import { reply } from "../_lib";

const cl = classNameFactory("lc-larp-");

interface Character {
    name: string;
    /** Overrides the global message format for this character. */
    format?: string;
}

const settings = definePluginSettings({
    messageFormat: {
        type: OptionType.STRING,
        description: "How in-character messages look. {name} is the character, {message} is what you typed.",
        default: "**{name}**: {message}"
    },
    actionFormat: {
        type: OptionType.STRING,
        description: "How actions look when your whole message is wrapped in single asterisks, like *draws a sword*. {action} is the text inside.",
        default: "_**{name}** {action}_"
    },
    oocPrefixes: {
        type: OptionType.STRING,
        description: "Messages starting with any of these (comma separated) are sent out of character, unchanged.",
        default: "((, //, ooc:"
    },
    characterList: {
        type: OptionType.COMPONENT,
        component: () => <CharacterSettings />
    },
    characters: {
        type: OptionType.CUSTOM,
        default: {} as Record<string, Character>
    },
    everywhere: {
        type: OptionType.CUSTOM,
        default: "" as string
    },
    perChannel: {
        type: OptionType.CUSTOM,
        // channelId -> character key, or "" to force out of character in that channel
        default: {} as Record<string, string>
    }
});

const keyOf = (name: string) => name.trim().toLowerCase();

function getCharacter(name: string | undefined): Character | undefined {
    return name ? settings.store.characters[keyOf(name)] : undefined;
}

export function activeCharacter(channelId: string): Character | undefined {
    const override = settings.store.perChannel[channelId];
    if (override !== undefined) return getCharacter(override);
    return getCharacter(settings.store.everywhere);
}

function addCharacter(name: string, format?: string) {
    const clean = name.trim().replace(/\s+/g, " ").slice(0, 80);
    const character: Character = { name: clean };
    if (format?.trim()) character.format = format.trim();
    settings.store.characters[keyOf(clean)] = character;
    return character;
}

function removeCharacter(name: string) {
    const key = keyOf(name);
    delete settings.store.characters[key];
    if (settings.store.everywhere === key) settings.store.everywhere = "";
    for (const [channelId, value] of Object.entries(settings.store.perChannel)) {
        if (value === key) delete settings.store.perChannel[channelId];
    }
}

function speakAs(channelId: string | null, name: string) {
    const key = keyOf(name);
    if (channelId) settings.store.perChannel[channelId] = key;
    else {
        settings.store.everywhere = key;
        settings.store.perChannel = {};
    }
}

function dropCharacter(channelId: string | null) {
    if (!channelId) {
        settings.store.everywhere = "";
        settings.store.perChannel = {};
        return;
    }
    // Keep an explicit "" when a global character would otherwise take over here
    if (settings.store.everywhere) settings.store.perChannel[channelId] = "";
    else delete settings.store.perChannel[channelId];
}

interface FormatOptions {
    messageFormat: string;
    actionFormat: string;
    oocPrefixes: string;
}

export function formatInCharacter(content: string, character: Character, opts: FormatOptions = settings.store) {
    const trimmed = content.trim();
    if (!trimmed) return content;

    const prefixes = opts.oocPrefixes.split(",").map(p => p.trim().toLowerCase()).filter(Boolean);
    if (prefixes.some(p => trimmed.toLowerCase().startsWith(p))) return content;

    const action = /^\*(?!\*)([\s\S]*?[^*\s])\*$/.exec(trimmed);
    if (action) {
        return opts.actionFormat
            .replaceAll("{name}", character.name)
            .replaceAll("{action}", action[1].trim());
    }

    return (character.format || opts.messageFormat)
        .replaceAll("{name}", character.name)
        .replaceAll("{message}", content);
}

const MaskIcon: IconComponent = ({ height = 20, width = 20, className }) => (
    <svg aria-hidden="true" role="img" width={width} height={height} className={className} viewBox="0 0 24 24">
        <path
            fill="currentColor"
            d="M3 4.5c0-.6.5-1 1.1-.9 2.6.6 5.3.9 7.9.9s5.3-.3 7.9-.9c.6-.1 1.1.3 1.1.9V9c0 5.5-3.9 10.5-9 11.5C6.9 19.5 3 14.5 3 9V4.5Zm4.2 5.1c-.4.3-.5.9-.1 1.3.8 1 2.1 1.4 3.3 1 .5-.2.7-.7.6-1.2-.2-.5-.7-.7-1.2-.6-.5.2-1 0-1.3-.4-.3-.4-.9-.4-1.3-.1Zm9.6 0c-.4-.3-1-.3-1.3.1-.3.4-.8.6-1.3.4-.5-.1-1 .1-1.2.6-.1.5.1 1 .6 1.2 1.2.4 2.5 0 3.3-1 .4-.4.3-1-.1-1.3Zm-7.5 4.9c-.4.3-.4.9 0 1.3a3.9 3.9 0 0 0 5.4 0c.4-.4.4-1 0-1.3-.4-.4-1-.4-1.4 0a2 2 0 0 1-2.6 0c-.4-.4-1-.4-1.4 0Z"
        />
    </svg>
);

function NewCharacterModal({ modalProps, channelId }: { modalProps: RenderModalProps; channelId: string; }) {
    const [name, setName] = useState("");
    const [format, setFormat] = useState("");

    return (
        <Modal
            {...modalProps}
            title="New character"
            subtitle="You'll start speaking as them in this channel right away."
            actions={[
                { text: "Cancel", variant: "secondary", onClick: modalProps.onClose },
                {
                    text: "Create and speak as",
                    variant: "primary",
                    disabled: !name.trim(),
                    onClick() {
                        const c = addCharacter(name, format);
                        speakAs(channelId, c.name);
                        modalProps.onClose();
                    }
                }
            ]}
        >
            <Flex flexDirection="column" gap={12}>
                <section>
                    <HeadingSecondary>Name</HeadingSecondary>
                    <TextInput value={name} onChange={setName} placeholder="Sir Reginald the Unready" autoFocus />
                </section>
                <section>
                    <HeadingSecondary>Message format (optional)</HeadingSecondary>
                    <TextInput value={format} onChange={setFormat} placeholder={settings.store.messageFormat} />
                    <Paragraph className={cl("hint")}>Leave empty to use the default from the plugin settings.</Paragraph>
                </section>
            </Flex>
        </Modal>
    );
}

function openCharacterMenu(event: React.MouseEvent, channelId: string) {
    const current = activeCharacter(channelId);
    const characters = Object.values(settings.store.characters).sort((a, b) => a.name.localeCompare(b.name));

    ContextMenuApi.openContextMenu(event, () => (
        <Menu.Menu navId="lc-larp-menu" onClose={ContextMenuApi.closeContextMenu} aria-label="Larp Mode">
            <Menu.MenuGroup label="Speak in this channel as">
                {characters.map(c => (
                    <Menu.MenuRadioItem
                        key={keyOf(c.name)}
                        id={`lc-larp-${keyOf(c.name)}`}
                        group="lc-larp-character"
                        label={c.name}
                        checked={current?.name === c.name}
                        action={() => speakAs(channelId, c.name)}
                    />
                ))}
                <Menu.MenuRadioItem
                    id="lc-larp-ooc"
                    group="lc-larp-character"
                    label="Myself (out of character)"
                    checked={!current}
                    action={() => dropCharacter(channelId)}
                />
            </Menu.MenuGroup>
            <Menu.MenuSeparator />
            <Menu.MenuItem
                id="lc-larp-new"
                label="New character..."
                action={() => openModal(props => <NewCharacterModal modalProps={props} channelId={channelId} />)}
            />
        </Menu.Menu>
    ));
}

const LarpButton: ChatBarButtonFactory = ({ channel, isAnyChat }) => {
    // subscribing re-renders the button whenever the active character changes
    settings.use(["perChannel", "everywhere", "characters"]);
    if (!isAnyChat) return null;

    const current = activeCharacter(channel.id);

    return (
        <ChatBarButton
            tooltip={current ? `Speaking as ${current.name}` : "Larp Mode: speaking as yourself"}
            onClick={e => openCharacterMenu(e, channel.id)}
            onContextMenu={e => openCharacterMenu(e, channel.id)}
        >
            <MaskIcon className={current ? cl("active") : undefined} />
        </ChatBarButton>
    );
};

function CharacterSettings() {
    const { characters } = settings.use(["characters"]);
    const [name, setName] = useState("");
    const list = Object.values(characters).sort((a, b) => a.name.localeCompare(b.name));

    return (
        <section className={cl("settings")}>
            <HeadingSecondary>Characters</HeadingSecondary>
            {list.length === 0 && <Paragraph>No characters yet. Add one below or use /larp add.</Paragraph>}
            {list.map(c => (
                <div key={keyOf(c.name)} className={cl("row")}>
                    <span className={cl("name")}>{c.name}</span>
                    <span className={cl("format")}>{c.format || "default format"}</span>
                    <Button size="small" variant="dangerSecondary" onClick={() => removeCharacter(c.name)}>Remove</Button>
                </div>
            ))}
            <div className={cl("row")}>
                <TextInput value={name} onChange={setName} placeholder="Character name" />
                <Button size="small" disabled={!name.trim()} onClick={() => { addCharacter(name); setName(""); }}>Add</Button>
            </div>
        </section>
    );
}

export default definePlugin({
    name: "LarpMode",
    description: "Speak as your characters. Pick a persona per channel from the mask button or /larp, and your messages are formatted in character. *Actions* and (( out of character )) lines are handled for you.",
    tags: ["Fun", "Chat", "Commands"],
    authors: [Devs.Larpcord],
    enabledByDefault: true,
    settings,

    chatBarButton: {
        icon: MaskIcon,
        render: LarpButton
    },

    onBeforeMessageSend(channelId, msg) {
        const character = activeCharacter(channelId);
        if (!character || !msg.content) return;
        msg.content = formatInCharacter(msg.content, character);
    },

    commands: [{
        name: "larp",
        description: "Larp Mode characters",
        inputType: ApplicationCommandInputType.BUILT_IN,
        options: [
            {
                name: "as",
                description: "Start speaking as a character in this channel",
                type: ApplicationCommandOptionType.SUB_COMMAND,
                options: [
                    { name: "name", description: "Character name (created if new)", type: ApplicationCommandOptionType.STRING, required: true },
                    { name: "everywhere", description: "Use this character in every channel", type: ApplicationCommandOptionType.BOOLEAN, required: false }
                ]
            },
            {
                name: "off",
                description: "Go back to speaking as yourself",
                type: ApplicationCommandOptionType.SUB_COMMAND,
                options: [
                    { name: "everywhere", description: "Drop your character in every channel", type: ApplicationCommandOptionType.BOOLEAN, required: false }
                ]
            },
            {
                name: "add",
                description: "Create a character",
                type: ApplicationCommandOptionType.SUB_COMMAND,
                options: [
                    { name: "name", description: "Character name", type: ApplicationCommandOptionType.STRING, required: true },
                    { name: "format", description: "Custom format, e.g. [{name}] {message}", type: ApplicationCommandOptionType.STRING, required: false }
                ]
            },
            {
                name: "remove",
                description: "Delete a character",
                type: ApplicationCommandOptionType.SUB_COMMAND,
                options: [
                    { name: "name", description: "Character name", type: ApplicationCommandOptionType.STRING, required: true }
                ]
            },
            {
                name: "list",
                description: "Show your characters",
                type: ApplicationCommandOptionType.SUB_COMMAND,
                options: []
            }
        ],
        execute(args, ctx) {
            const sub = args[0];
            const opts = sub.options ?? [];
            const channelId = ctx.channel.id;

            switch (sub.name) {
                case "as": {
                    const name = findOption<string>(opts, "name", "");
                    const everywhere = findOption<boolean>(opts, "everywhere", false);
                    const character = getCharacter(name) ?? addCharacter(name);
                    speakAs(everywhere ? null : channelId, character.name);
                    reply(channelId, `You're now speaking as **${character.name}** ${everywhere ? "everywhere" : "in this channel"}. Start a message with \`((\` to talk out of character.`);
                    break;
                }
                case "off": {
                    const everywhere = findOption<boolean>(opts, "everywhere", false);
                    dropCharacter(everywhere ? null : channelId);
                    reply(channelId, everywhere ? "Out of character everywhere." : "Out of character in this channel.");
                    break;
                }
                case "add": {
                    const name = findOption<string>(opts, "name", "");
                    const format = findOption<string>(opts, "format", "");
                    if (format && !format.includes("{message}")) {
                        reply(channelId, "A custom format needs `{message}` in it, otherwise your words would disappear.");
                        break;
                    }
                    const c = addCharacter(name, format);
                    reply(channelId, `Added **${c.name}**. Use \`/larp as name:${c.name}\` to speak as them.`);
                    break;
                }
                case "remove": {
                    const name = findOption<string>(opts, "name", "");
                    if (!getCharacter(name)) {
                        reply(channelId, `There's no character called **${name}**.`);
                        break;
                    }
                    removeCharacter(name);
                    reply(channelId, `Removed **${name}**.`);
                    break;
                }
                case "list": {
                    const current = activeCharacter(channelId);
                    const list = Object.values(settings.store.characters)
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map(c => `${c.name === current?.name ? "**" + c.name + "** (here)" : c.name}${c.format ? ` \`${c.format}\`` : ""}`);
                    reply(channelId, list.length ? `Your characters:\n${list.join("\n")}` : "No characters yet. Try `/larp as name:Your Hero`.");
                    break;
                }
            }
        }
    }]
});
