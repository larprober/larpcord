/*
 * Larpcord, a Discord client mod
 * Copyright (c) 2026 Larpcord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption } from "@api/Commands";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

import { reply } from "../_lib";

type Effect = (text: string) => string;

function offsetAlphabet(upper: number, lower: number, digits?: number): Effect {
    return text => Array.from(text, ch => {
        const c = ch.codePointAt(0)!;
        if (c >= 65 && c <= 90) return String.fromCodePoint(upper + c - 65);
        if (c >= 97 && c <= 122) return String.fromCodePoint(lower + c - 97);
        if (digits !== undefined && c >= 48 && c <= 57) return String.fromCodePoint(digits + c - 48);
        return ch;
    }).join("");
}

function charMap(from: string, to: string): Effect {
    const src = Array.from(from), dst = Array.from(to);
    const map = new Map(src.map((c, i) => [c, dst[i]]));
    return text => Array.from(text, ch => map.get(ch) ?? ch).join("");
}

const smallCaps = charMap(
    "abcdefghijklmnopqrstuvwxyz",
    "ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀꜱᴛᴜᴠᴡxʏᴢ"
);

const flipChars = charMap(
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890.,'\"?!()[]{}<>_&",
    "ɐqɔpǝɟƃɥᴉɾʞlɯuodbɹsʇnʌʍxʎz∀ᗺƆᗡƎℲ⅁HIſʞ˥WNOԀΌᴚS⊥∩ΛMX⅄ZƖᄅƐㄣϛ9ㄥ860˙',„¿¡)(][}{><‾⅋"
);

function bubble(text: string) {
    return Array.from(text, ch => {
        const c = ch.codePointAt(0)!;
        if (c >= 65 && c <= 90) return String.fromCodePoint(0x24B6 + c - 65);
        if (c >= 97 && c <= 122) return String.fromCodePoint(0x24D0 + c - 97);
        if (c >= 49 && c <= 57) return String.fromCodePoint(0x2460 + c - 49);
        if (c === 48) return "⓪";
        return ch;
    }).join("");
}

/** Alternates case letter by letter across the whole text, starting lowercase. */
function mock(text: string) {
    let upper = true;
    return Array.from(text, ch => {
        if (ch.toLowerCase() === ch.toUpperCase()) return ch;
        upper = !upper;
        return upper ? ch.toUpperCase() : ch.toLowerCase();
    }).join("");
}

const OWO_FACES = [" uwu", " owo", " >w<", " ^w^", " :3"];
function owo(text: string) {
    const out = text
        .replace(/(?:r|l)/g, "w")
        .replace(/(?:R|L)/g, "W")
        .replace(/n([aeiou])/g, "ny$1")
        .replace(/N([aeiou])/g, "Ny$1")
        .replace(/N([AEIOU])/g, "NY$1")
        .replace(/ove\b/g, "uv");
    return out + OWO_FACES[Math.floor(Math.random() * OWO_FACES.length)];
}

function vaporwave(text: string) {
    return Array.from(text, ch => {
        const c = ch.codePointAt(0)!;
        if (c === 32) return "　";
        if (c >= 0x21 && c <= 0x7E) return String.fromCodePoint(c + 0xFEE0);
        return ch;
    }).join("");
}

function zalgo(text: string) {
    return Array.from(text, ch => {
        if (!/\p{L}|\p{N}/u.test(ch)) return ch;
        let marks = "";
        const n = 1 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) marks += String.fromCodePoint(0x0300 + Math.floor(Math.random() * 0x70));
        return ch + marks;
    }).join("");
}

interface EffectDef {
    label: string;
    apply: Effect;
    /** Reverses the order of the text, so protected tokens must be reversed too. */
    reverses?: boolean;
}

export const Effects: Record<string, EffectDef> = {
    mock: { label: "mOcKiNg", apply: mock },
    owo: { label: "owo speak", apply: owo },
    vaporwave: { label: "ｖａｐｏｒｗａｖｅ", apply: vaporwave },
    smallcaps: { label: "sᴍᴀʟʟ ᴄᴀᴘs", apply: smallCaps },
    script: { label: "𝓼𝓬𝓻𝓲𝓹𝓽", apply: offsetAlphabet(0x1D4D0, 0x1D4EA) },
    gothic: { label: "𝖌𝖔𝖙𝖍𝖎𝖈", apply: offsetAlphabet(0x1D56C, 0x1D586) },
    monospace: { label: "𝚖𝚘𝚗𝚘𝚜𝚙𝚊𝚌𝚎", apply: offsetAlphabet(0x1D670, 0x1D68A, 0x1D7F6) },
    bubble: { label: "ⓑⓤⓑⓑⓛⓔ", apply: bubble },
    upsidedown: { label: "uʍop ǝpᴉsdn", apply: t => Array.from(flipChars(t)).reverse().join(""), reverses: true },
    reverse: { label: "esrever", apply: t => Array.from(t).reverse().join(""), reverses: true },
    spaced: { label: "s p a c e d", apply: t => Array.from(t).join(" ").replace(/ {3}/g, "   ") },
    zalgo: { label: "zalgo", apply: zalgo },
};

// Mentions, custom emoji, timestamps and links must survive untouched or they stop working.
const PROTECTED = /(<a?:\w+:\d+>|<[@#][!&]?\d+>|<\/[\w -]+:\d+>|<t:-?\d+(?::\w)?>|https?:\/\/\S+|:\w+:)/;

export function applyEffect(name: string, text: string) {
    const effect = Effects[name];
    if (!effect) throw new Error(`Unknown effect ${name}`);

    const pieces = text.split(PROTECTED).map((piece, i) => i % 2 === 1 ? piece : effect.apply(piece));
    if (effect.reverses) pieces.reverse();
    return pieces.join("").slice(0, 2000);
}

export default definePlugin({
    name: "TextEffects",
    description: "/fx turns your text into mocking case, owo, vaporwave, small caps, script, gothic, bubbles, upside down and more. Mentions, emoji and links are left intact.",
    tags: ["Fun", "Chat", "Commands"],
    authors: [Devs.Larpcord],
    enabledByDefault: true,

    commands: [{
        name: "fx",
        description: "Send text with an effect applied",
        inputType: ApplicationCommandInputType.BUILT_IN,
        options: [
            {
                name: "style",
                description: "Which effect",
                type: ApplicationCommandOptionType.STRING,
                required: true,
                choices: Object.entries(Effects).map(([value, { label }]) => ({ name: label, value, label, displayName: label }))
            },
            {
                name: "text",
                description: "What to say",
                type: ApplicationCommandOptionType.STRING,
                required: true
            }
        ],
        execute(args, ctx) {
            const style = findOption<string>(args, "style", "");
            const text = findOption<string>(args, "text", "");
            try {
                return { content: applyEffect(style, text) };
            } catch (e: any) {
                reply(ctx.channel.id, e?.message ?? String(e));
            }
        }
    }]
});
