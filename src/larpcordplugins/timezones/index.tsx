/*
 * Larpcord, a Discord client mod
 * Copyright (c) 2026 Larpcord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption } from "@api/Commands";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import * as DataStore from "@api/DataStore";
import { definePluginSettings } from "@api/Settings";
import { Paragraph } from "@components/Paragraph";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import type { RenderModalProps, User } from "@vencord/discord-types";
import { LocaleStore, Menu, Modal, openModal, React, SearchableSelect, Tooltip, useMemo, UserStore, useState } from "@webpack/common";

import { reply } from "../_lib";

const STORE_KEY = "Larpcord_Timezones";

const settings = definePluginSettings({
    clock: {
        type: OptionType.SELECT,
        description: "Clock format",
        options: [
            { label: "Follow my system", value: "auto", default: true },
            { label: "24 hour (17:30)", value: "24" },
            { label: "12 hour (5:30 PM)", value: "12" }
        ]
    },
    showInChat: {
        type: OptionType.BOOLEAN,
        description: "Show people's local time next to their name in chat",
        default: true
    }
});

// ---- tiny external store so every decoration re-renders together ----

let zones: Record<string, string> = {};
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());
const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => void listeners.delete(l);
};

let minuteStamp = Math.floor(Date.now() / 60_000);
let ticker: ReturnType<typeof setInterval> | null = null;

async function loadZones() {
    zones = (await DataStore.get<Record<string, string>>(STORE_KEY)) ?? {};
    emit();
}

async function setZone(userId: string, tz: string | null) {
    zones = { ...zones };
    if (tz) zones[userId] = tz;
    else delete zones[userId];
    await DataStore.set(STORE_KEY, zones);
    emit();
}

function useZone(userId: string) {
    return React.useSyncExternalStore(subscribe, () => zones[userId]);
}

function useMinute() {
    return React.useSyncExternalStore(subscribe, () => minuteStamp);
}

// ---- time helpers ----

let zoneList: string[] | null = null;
function allZones() {
    return zoneList ??= (Intl as any).supportedValuesOf?.("timeZone") ?? ["UTC"];
}

export function isValidZone(tz: string) {
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: tz });
        return true;
    } catch {
        return false;
    }
}

/** Minutes the zone is ahead of UTC at the given moment (DST aware). */
export function zoneOffset(tz: string, at = new Date()) {
    const d = new Date(at);
    d.setSeconds(0, 0);
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: tz, hourCycle: "h23",
        year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
    }).formatToParts(d);
    const get = (t: string) => Number(parts.find(p => p.type === t)!.value);
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
    return Math.round((asUtc - d.getTime()) / 60_000);
}

export function relativeOffset(tz: string, at = new Date()) {
    const diff = zoneOffset(tz, at) + at.getTimezoneOffset();
    if (diff === 0) return "same time as you";
    const abs = Math.abs(diff);
    const h = Math.floor(abs / 60), m = abs % 60;
    const amount = m ? `${h}h ${m}m` : `${h}h`;
    return `${amount} ${diff > 0 ? "ahead of" : "behind"} you`;
}

/** Discord's UI language, so the times match Discord's own timestamps rather than the OS locale. */
function uiLocale() {
    try {
        return LocaleStore?.locale || undefined;
    } catch {
        return undefined;
    }
}

export function formatLocalTime(tz: string, at = new Date(), clock = settings.store.clock) {
    const time = new Intl.DateTimeFormat(uiLocale(), {
        timeZone: tz,
        hour: "numeric",
        minute: "2-digit",
        hour12: clock === "auto" ? undefined : clock === "12"
    }).format(at);

    const dayOf = (zone?: string) => new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
    const theirs = dayOf(tz), mine = dayOf();
    if (theirs === mine) return time;
    return `${time} ${theirs > mine ? "tomorrow" : "yesterday"}`;
}

function displayName(user: User | undefined, fallback = "They") {
    return (user as any)?.globalName ?? user?.username ?? fallback;
}

// ---- UI ----

function LocalTime({ userId }: { userId: string; }) {
    const tz = useZone(userId);
    useMinute();
    if (!tz) return null;

    const name = displayName(UserStore.getUser(userId));
    return (
        <Tooltip text={`${name}'s local time · ${tz.replaceAll("_", " ")} · ${relativeOffset(tz)}`}>
            {props => <span {...props} className="lc-tz-time">{formatLocalTime(tz)}</span>}
        </Tooltip>
    );
}

function ZoneModal({ modalProps, user }: { modalProps: RenderModalProps; user: User; }) {
    const current = zones[user.id];
    const [value, setValue] = useState<string | undefined>(current);
    const options = useMemo(() => allZones().map(z => ({ label: z.replaceAll("_", " "), value: z })), []);

    return (
        <Modal
            {...modalProps}
            title={`Time zone for ${displayName(user, user.username)}`}
            subtitle="Only you can see this. It's stored on this computer."
            actions={[
                ...(current ? [{ text: "Clear", variant: "critical-primary", onClick() { setZone(user.id, null); modalProps.onClose(); } }] : []),
                { text: "Cancel", variant: "secondary", onClick: modalProps.onClose },
                {
                    text: "Save",
                    variant: "primary",
                    disabled: !value,
                    onClick() {
                        if (value) setZone(user.id, value);
                        modalProps.onClose();
                    }
                }
            ]}
        >
            <SearchableSelect
                options={options}
                value={value}
                placeholder="Search a city, e.g. Istanbul or New York"
                maxVisibleItems={6}
                closeOnSelect={true}
                onChange={v => setValue(v)}
            />
            {value && (
                <Paragraph className="lc-tz-preview">
                    It's {formatLocalTime(value)} there right now, {relativeOffset(value)}.
                </Paragraph>
            )}
        </Modal>
    );
}

const userContextPatch: NavContextMenuPatchCallback = (children, { user }: { user?: User; }) => {
    if (!user || user.id === UserStore.getCurrentUser()?.id) return;
    const tz = zones[user.id];
    children.push(
        <Menu.MenuItem
            id="lc-tz-set"
            label={tz ? `Local time: ${formatLocalTime(tz)}` : "Set time zone..."}
            subtext={tz ? "Change time zone" : undefined}
            action={() => openModal(props => <ZoneModal modalProps={props} user={user} />)}
        />
    );
};

export default definePlugin({
    name: "Timezones",
    description: "Right-click anyone to set their time zone, then see their local time next to their name in chat, including when it's already tomorrow for them. /time shows it too.",
    tags: ["Friends", "Utility", "Chat"],
    authors: [Devs.Larpcord],
    enabledByDefault: true,
    settings,

    contextMenus: {
        "user-context": userContextPatch
    },

    renderMessageDecoration(props) {
        if (!settings.store.showInChat) return null;
        const id = props.message?.author?.id;
        return id ? <LocalTime userId={id} /> : null;
    },

    async start() {
        await loadZones();
        ticker = setInterval(() => {
            const now = Math.floor(Date.now() / 60_000);
            if (now !== minuteStamp) {
                minuteStamp = now;
                emit();
            }
        }, 5_000);
    },

    stop() {
        if (ticker) clearInterval(ticker);
        ticker = null;
    },

    commands: [{
        name: "time",
        description: "See someone's local time",
        inputType: ApplicationCommandInputType.BUILT_IN,
        options: [
            { name: "user", description: "Whose time (leave empty to list everyone you've set)", type: ApplicationCommandOptionType.USER, required: false },
            { name: "zone", description: "Set their time zone, e.g. Europe/Istanbul", type: ApplicationCommandOptionType.STRING, required: false }
        ],
        async execute(args, ctx) {
            const userId = findOption<string>(args, "user", "");
            const zone = findOption<string>(args, "zone", "").trim();

            if (!userId) {
                const entries = Object.entries(zones);
                if (!entries.length) {
                    reply(ctx.channel.id, "You haven't set anyone's time zone yet. Right-click a user and choose Set time zone, or use `/time user:@someone zone:Europe/London`.");
                    return;
                }
                const lines = entries
                    .map(([id, tz]) => ({ id, tz, off: zoneOffset(tz) }))
                    .sort((a, b) => a.off - b.off)
                    .map(({ id, tz }) => `<@${id}> ${formatLocalTime(tz)} (${tz.replaceAll("_", " ")})`);
                reply(ctx.channel.id, lines.join("\n").slice(0, 2000));
                return;
            }

            if (zone) {
                const match = allZones().find(z => z.toLowerCase() === zone.toLowerCase().replaceAll(" ", "_"))
                    ?? allZones().find(z => z.toLowerCase().endsWith("/" + zone.toLowerCase().replaceAll(" ", "_")));
                const tz = match ?? (isValidZone(zone) ? zone : null);
                if (!tz) {
                    reply(ctx.channel.id, `I don't know the time zone \`${zone}\`. Try a city like \`Europe/Istanbul\` or just \`Istanbul\`.`);
                    return;
                }
                await setZone(userId, tz);
            }

            const tz = zones[userId];
            reply(ctx.channel.id, tz
                ? `It's **${formatLocalTime(tz)}** for <@${userId}> (${tz.replaceAll("_", " ")}), ${relativeOffset(tz)}.`
                : `No time zone set for <@${userId}>. Add \`zone:\` to set one.`);
        }
    }]
});
