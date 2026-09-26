/*
 * Larpcord, a Discord client mod
 * Copyright (c) 2026 Larpcord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption } from "@api/Commands";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

import { reply } from "../_lib";

const MAX_DICE_PER_TERM = 100;
const MAX_TOTAL_DICE = 300;
const MAX_SIDES = 1000;
const MAX_TERMS = 20;
const MAX_REPEAT = 20;
const SHOW_INDIVIDUAL_UP_TO = 20;

interface DiceTerm {
    kind: "dice";
    sign: 1 | -1;
    count: number;
    sides: number;
    keep?: { highest: boolean; n: number; };
    source: string;
}

interface FlatTerm {
    kind: "flat";
    sign: 1 | -1;
    value: number;
}

type Term = DiceTerm | FlatTerm;

/** Unbiased integer in [1, sides] from the system CSPRNG. */
export function rollDie(sides: number) {
    const limit = Math.floor(0x100000000 / sides) * sides;
    const buf = new Uint32Array(1);
    let x: number;
    do {
        crypto.getRandomValues(buf);
        x = buf[0];
    } while (x >= limit);
    return (x % sides) + 1;
}

const TERM = /([+-]?)(?:(\d*)d(\d+|%)(?:(kh|kl|k|dh|dl)(\d+))?|(\d+))/y;

export function parseExpression(input: string): { repeat: number; terms: Term[]; } {
    let expr = input.toLowerCase().trim();

    let repeat = 1;
    const rep = /^(\d+)\s*x\s*(?=\d*d)/.exec(expr);
    if (rep) {
        repeat = Number(rep[1]);
        expr = expr.slice(rep[0].length);
        if (repeat < 1 || repeat > MAX_REPEAT) throw new Error(`You can repeat a roll 1 to ${MAX_REPEAT} times.`);
    }

    // "adv" / "dis" turn the first single d20 into 2d20 keep highest / lowest
    let advantage = null as "adv" | "dis" | null;
    expr = expr
        .replace(/(?<![a-z])(advantage|adv|disadvantage|dis)(?![a-z])/g, (w: string) => {
            advantage = w.startsWith("adv") ? "adv" : "dis";
            return " ";
        })
        .replace(/\s*([+-])\s*/g, "$1")
        .trim()
        .replace(/\+{2,}/g, "+")
        .replace(/^\+|\+$/g, "");

    // Spaces are fine around + and -, but "2d6 3" is ambiguous, don't guess
    if (/\s/.test(expr)) throw new Error("Put a + or - between the parts of your roll, like `2d6+3`.");

    if (advantage) {
        const singleD20 = /(^|[+-])1?d20(?![0-9kd])/;
        // "adv+5" means "d20 with advantage, plus 5"
        if (!singleD20.test(expr)) expr = "d20" + (expr && !/^[+-]/.test(expr) ? "+" : "") + expr;
        expr = expr.replace(singleD20, `$12d20${advantage === "adv" ? "kh1" : "kl1"}`);
    }

    if (!expr) throw new Error("Nothing to roll. Try something like `d20+3` or `4d6dl1`.");

    const terms: Term[] = [];
    let totalDice = 0;
    TERM.lastIndex = 0;
    while (TERM.lastIndex < expr.length) {
        const start = TERM.lastIndex;
        const m = TERM.exec(expr);
        if (!m || m[0] === "") throw new Error(`I couldn't read \`${expr.slice(start)}\`.`);
        if (terms.length > 0 && !m[1]) throw new Error(`Put a + or - before \`${m[0]}\`.`);

        const sign = m[1] === "-" ? -1 : 1;
        if (m[6] !== undefined) {
            terms.push({ kind: "flat", sign, value: Number(m[6]) });
        } else {
            const count = m[2] ? Number(m[2]) : 1;
            const sides = m[3] === "%" ? 100 : Number(m[3]);
            if (count < 1 || count > MAX_DICE_PER_TERM) throw new Error(`Roll between 1 and ${MAX_DICE_PER_TERM} dice at a time.`);
            if (sides < 1 || sides > MAX_SIDES) throw new Error(`Dice can have 1 to ${MAX_SIDES} sides.`);

            let keep: DiceTerm["keep"];
            if (m[4]) {
                const n = Number(m[5]);
                const op = m[4];
                if (op === "dh" || op === "dl") {
                    if (n >= count) throw new Error(`Can't drop ${n} of ${count} dice.`);
                    keep = { highest: op === "dl", n: count - n };
                } else {
                    if (n < 1 || n > count) throw new Error(`Can't keep ${n} of ${count} dice.`);
                    keep = { highest: op !== "kl", n };
                }
            }
            totalDice += count;
            terms.push({ kind: "dice", sign, count, sides, keep, source: m[0].replace(/^[+-]/, "") });
        }
        if (terms.length > MAX_TERMS) throw new Error(`That's more than ${MAX_TERMS} parts in one roll.`);
    }
    if (totalDice * repeat > MAX_TOTAL_DICE) throw new Error(`That's more than ${MAX_TOTAL_DICE} dice in one go.`);

    return { repeat, terms };
}

interface RollResult {
    total: number;
    text: string;
    natural?: 1 | 20;
}

export function evaluate(terms: Term[]): RollResult {
    let total = 0;
    const parts: string[] = [];
    let natural: RollResult["natural"];

    const d20Terms = terms.filter(t => t.kind === "dice" && t.sides === 20);
    const singleD20 = d20Terms.length === 1 && ((d20Terms[0] as DiceTerm).keep?.n ?? (d20Terms[0] as DiceTerm).count) === 1;

    for (const [i, term] of terms.entries()) {
        const op = i === 0 ? (term.sign < 0 ? "-" : "") : term.sign < 0 ? " - " : " + ";

        if (term.kind === "flat") {
            total += term.sign * term.value;
            parts.push(`${op}${term.value}`);
            continue;
        }

        const rolls = Array.from({ length: term.count }, () => rollDie(term.sides));
        const kept = new Array(rolls.length).fill(true);
        if (term.keep) {
            const order = rolls
                .map((v, idx) => ({ v, idx }))
                .sort((a, b) => term.keep!.highest ? b.v - a.v : a.v - b.v);
            order.slice(term.keep.n).forEach(({ idx }) => kept[idx] = false);
        }
        const sum = rolls.reduce((acc, v, idx) => acc + (kept[idx] ? v : 0), 0);
        total += term.sign * sum;

        if (term.sides === 20 && singleD20) {
            const keptValue = rolls.find((_, idx) => kept[idx]);
            if (keptValue === 20) natural = 20;
            else if (keptValue === 1) natural = 1;
        }

        const shown = rolls.length <= SHOW_INDIVIDUAL_UP_TO
            ? rolls.map((v, idx) => kept[idx] ? String(v) : `~~${v}~~`).join(", ")
            : `${rolls.filter((_, idx) => kept[idx]).length} dice, sum ${sum}`;
        parts.push(`${op}(${shown})`);
    }

    return { total, text: parts.join(""), natural };
}

export function describeRoll(expression: string, reason?: string) {
    const { repeat, terms } = parseExpression(expression);
    const label = reason?.trim() ? `**${reason.trim()}** · ` : "";
    const code = "`" + expression.trim().replace(/`/g, "") + "`";

    const lines: string[] = [];
    const totals: number[] = [];
    for (let i = 0; i < repeat; i++) {
        const r = evaluate(terms);
        totals.push(r.total);
        const nat = r.natural ? `  *natural ${r.natural}*` : "";
        const onlyFlat = terms.every(t => t.kind === "flat");
        lines.push(onlyFlat ? `**${r.total}**` : `${r.text} = **${r.total}**${nat}`);
    }

    if (repeat === 1) return `${label}${code}  ${lines[0]}`;
    return `${label}${code}\n${lines.map((l, i) => `${i + 1}. ${l}`).join("\n")}\nTotals: ${totals.join(", ")}`;
}

export default definePlugin({
    name: "DiceRoller",
    description: "Tabletop dice for your campaigns: /roll 2d20kh1+5, 4d6dl1, 6x4d6dl1, d20 adv, d%. Also /pick to let fate choose.",
    tags: ["Fun", "Commands"],
    authors: [Devs.Larpcord],
    enabledByDefault: true,

    commands: [
        {
            name: "roll",
            description: "Roll dice, e.g. 2d6+3, d20 adv, 4d6dl1, 6x4d6dl1",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "dice",
                    description: "What to roll, e.g. 1d20+5",
                    type: ApplicationCommandOptionType.STRING,
                    required: true
                },
                {
                    name: "reason",
                    description: "What the roll is for, e.g. Stealth check",
                    type: ApplicationCommandOptionType.STRING,
                    required: false
                },
                {
                    name: "secret",
                    description: "Only you see the result",
                    type: ApplicationCommandOptionType.BOOLEAN,
                    required: false
                }
            ],
            execute(args, ctx) {
                const dice = findOption<string>(args, "dice", "");
                const reason = findOption<string>(args, "reason", "");
                const secret = findOption<boolean>(args, "secret", false);

                let content: string;
                try {
                    content = describeRoll(dice, reason);
                } catch (e: any) {
                    reply(ctx.channel.id, e?.message ?? String(e));
                    return;
                }

                if (secret) {
                    reply(ctx.channel.id, `Secret roll. ${content}`);
                    return;
                }
                return { content };
            }
        },
        {
            name: "pick",
            description: "Pick one option at random",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "options",
                    description: "Choices separated by commas, e.g. fight, flee, bribe the guard",
                    type: ApplicationCommandOptionType.STRING,
                    required: true
                }
            ],
            execute(args, ctx) {
                const choices = findOption<string>(args, "options", "")
                    .split(/[,|\n]/)
                    .map(s => s.trim())
                    .filter(Boolean);

                if (choices.length < 2) {
                    reply(ctx.channel.id, "Give me at least two options, separated by commas.");
                    return;
                }

                const pick = choices[rollDie(choices.length) - 1];
                return { content: `Choosing between ${choices.map(c => `\`${c.replace(/`/g, "")}\``).join(", ")}: **${pick}**` };
            }
        }
    ]
});
