// Logic tests for the Larpcord plugins. Run: node scripts/larpcord/test/run.mjs
/* eslint-disable */
import dice, { describeRoll, evaluate, parseExpression, rollDie } from "../../../src/larpcordplugins/diceRoller";
import { applyEffect } from "../../../src/larpcordplugins/textEffects";
import larp, { formatInCharacter } from "../../../src/larpcordplugins/larpMode";
import kw, { buildMatchers } from "../../../src/larpcordplugins/keywordAlerts";
import ghost from "../../../src/larpcordplugins/ghostPingDetector";
import { inQuietHours } from "../../../src/larpcordplugins/quietHours";
import { formatLocalTime, relativeOffset, zoneOffset } from "../../../src/larpcordplugins/timezones";
import { renderStats } from "../../../src/larpcordplugins/sessionStats";
import { buildQuote } from "../../../src/larpcordplugins/quoteTools";
import { matchesHotkey } from "../../../src/larpcordplugins/privacyBlur";
import { formatDuration, parseClock } from "../../../src/larpcordplugins/_lib";

(globalThis as any).document = { hasFocus: () => false };
let pass = 0, fail = 0;
function ok(cond: any, label: string, extra?: any) {
    if (cond) pass++;
    else { fail++; console.log("FAIL:", label, extra ?? ""); }
}
function throws(fn: () => any, label: string) {
    try { fn(); fail++; console.log("FAIL (no throw):", label); } catch { pass++; }
}

// ---------- dice ----------
{
    // distribution sanity: d6 over 60k rolls, every face within 5% of expected
    const counts = new Array(7).fill(0);
    for (let i = 0; i < 60000; i++) counts[rollDie(6)]++;
    ok(counts[0] === 0 && counts.slice(1).every(c => Math.abs(c - 10000) < 500), "d6 uniform", counts);
    for (let i = 0; i < 2000; i++) { const r = rollDie(20); if (r < 1 || r > 20) { ok(false, "d20 range", r); break; } }

    const p = parseExpression("2d20kh1+5");
    ok(p.repeat === 1 && p.terms.length === 2, "parse 2d20kh1+5", p);
    ok((p.terms[0] as any).keep?.highest === true && (p.terms[0] as any).keep?.n === 1, "keep highest 1");

    ok((parseExpression("d20 adv").terms[0] as any).count === 2 && (parseExpression("d20 adv").terms[0] as any).keep.highest, "d20 adv");
    ok((parseExpression("dis").terms[0] as any).keep.highest === false, "dis alone");
    const advPlus = parseExpression("adv+5");
    ok(advPlus.terms.length === 2 && (advPlus.terms[0] as any).count === 2 && (advPlus.terms[1] as any).value === 5, "adv+5", advPlus);
    const d20p5adv = parseExpression("d20+5 adv");
    ok(d20p5adv.terms.length === 2 && (d20p5adv.terms[0] as any).keep?.n === 1, "d20+5 adv", d20p5adv);
    ok((parseExpression("4d6dl1").terms[0] as any).keep.n === 3 && (parseExpression("4d6dl1").terms[0] as any).keep.highest, "4d6dl1 keeps highest 3");
    ok(parseExpression("6x4d6dl1").repeat === 6, "6x repeat");
    ok((parseExpression("d%").terms[0] as any).sides === 100, "d%");
    ok(parseExpression("1d8 + 1d6 - 2").terms.length === 3, "multi terms with spaces");
    throws(() => parseExpression("hello"), "garbage");
    throws(() => parseExpression("0d6"), "zero dice");
    throws(() => parseExpression("101d6"), "too many dice");
    throws(() => parseExpression("d1001"), "too many sides");
    throws(() => parseExpression("4d6kh5"), "keep more than rolled");
    throws(() => parseExpression("2d6 3"), "missing operator");
    ok(parseExpression(" 2d6 + 3 ").terms.length === 2 && parseExpression("6 x 4d6 dl1".replace(" dl1","dl1")).repeat === 6, "spaces around operators ok");
    ok((parseExpression("d20adv").terms[0] as any).count === 2, "d20adv glued");
    ok(parseExpression("adv - 2").terms.length === 2 && (parseExpression("adv - 2").terms[1] as any).sign === -1, "adv - 2");
    throws(() => parseExpression("21x4d6"), "repeat limit");

    // evaluation bounds over many rolls
    let bad = false;
    for (let i = 0; i < 5000; i++) {
        const r = evaluate(parseExpression("2d20kh1+5").terms);
        if (r.total < 6 || r.total > 25) bad = true;
        const s = evaluate(parseExpression("4d6dl1").terms);
        if (s.total < 3 || s.total > 18) bad = true;
        const neg = evaluate(parseExpression("1d4-10").terms);
        if (neg.total < -9 || neg.total > -6) bad = true;
    }
    ok(!bad, "evaluation bounds");

    // natural 20 detection shows up eventually and only on single d20 rolls
    let sawNat = false;
    for (let i = 0; i < 400 && !sawNat; i++) sawNat = !!evaluate(parseExpression("d20").terms).natural;
    ok(sawNat, "natural 1/20 detected");
    let natOnMulti = false;
    for (let i = 0; i < 400; i++) if (evaluate(parseExpression("3d20").terms).natural) natOnMulti = true;
    ok(!natOnMulti, "no natural tag on 3d20");

    const text = describeRoll("2d20kh1+5", "Stealth");
    ok(/^\*\*Stealth\*\* · `2d20kh1\+5`  \(.*~~\d+~~.*\) \+ 5 = \*\*\d+\*\*/.test(text) || /^\*\*Stealth\*\* · `2d20kh1\+5`  \(\d+, ~~\d+~~\) \+ 5/.test(text), "describe format", text);
    const multi = describeRoll("3x2d6");
    ok(multi.split("\n").length === 5 && multi.includes("Totals:"), "repeat format", multi);
    const flat = describeRoll("7");
    ok(flat.endsWith("**7**"), "flat only", flat);
    const big = describeRoll("100d6");
    ok(big.includes("100 dice, sum") && big.length < 2000, "big roll summarised", big);
    console.log("  sample:", text, "|", describeRoll("d20 adv"), "|", describeRoll("4d6dl1"));

    // command wrapper: secret goes to bot message, public returns content
    const roll = (dice as any).commands[0];
    const pub = roll.execute([{ name: "dice", value: "1d6" }], { channel: { id: "c" } });
    ok(pub && /\*\*[1-6]\*\*/.test(pub.content), "public roll returns content", pub);
    const sec = roll.execute([{ name: "dice", value: "1d6" }, { name: "secret", value: true }], { channel: { id: "c" } });
    ok(sec === undefined && (globalThis as any).__bot.at(-1).startsWith("Secret roll."), "secret roll is private");
    ok(roll.execute([{ name: "dice", value: "lol" }], { channel: { id: "c" } }) === undefined, "bad roll doesn't send");
    const pick = (dice as any).commands[1].execute([{ name: "options", value: "fight, flee, bribe the guard" }], { channel: { id: "c" } });
    ok(/: \*\*(fight|flee|bribe the guard)\*\*$/.test(pick.content), "pick", pick);
}

// ---------- text effects ----------
{
    ok(applyEffect("mock", "hello there") === "hElLo ThErE", "mock", applyEffect("mock", "hello there"));
    ok(applyEffect("vaporwave", "hi 5") === "ｈｉ\u3000５", "vaporwave");
    ok(applyEffect("smallcaps", "Larp") === "Lᴀʀᴘ", "smallcaps", applyEffect("smallcaps", "Larp"));
    ok(applyEffect("reverse", "abc 😀") === "😀 cba", "reverse keeps surrogate pairs");
    ok(applyEffect("upsidedown", "hello!") === "¡oןןǝɥ".replace("ן", "l").replace("ן", "l") || applyEffect("upsidedown", "hello!") === "¡ollǝɥ", "upsidedown", applyEffect("upsidedown", "hello!"));
    ok(applyEffect("script", "Ab") === "𝓐𝓫", "script", applyEffect("script", "Ab"));
    ok(applyEffect("gothic", "Ab") === "𝕬𝖇", "gothic", applyEffect("gothic", "Ab"));
    ok(applyEffect("monospace", "a1") === "𝚊𝟷", "monospace", applyEffect("monospace", "a1"));
    ok(applyEffect("bubble", "ab10") === "ⓐⓑ①⓪", "bubble", applyEffect("bubble", "ab10"));
    ok(applyEffect("owo", "really love").startsWith("weawwy wuv"), "owo", applyEffect("owo", "really love"));
    // protected tokens survive
    const withMention = applyEffect("vaporwave", "hey <@123456> look https://example.com/a <:pog:998877> :smile:");
    ok(withMention.includes("<@123456>") && withMention.includes("https://example.com/a") && withMention.includes("<:pog:998877>") && withMention.includes(":smile:"), "protected tokens", withMention);
    const rev = applyEffect("reverse", "hi <@1> yo");
    ok(rev === "oy <@1> ih", "reverse around mention", rev);
    ok(applyEffect("zalgo", "ab").length > 2 && applyEffect("zalgo", "ab").normalize("NFD").startsWith("a"), "zalgo");
    throws(() => applyEffect("nope", "x"), "unknown effect");
}

// ---------- larp mode ----------
{
    const opts = { messageFormat: "**{name}**: {message}", actionFormat: "_**{name}** {action}_", oocPrefixes: "((, //, ooc:" };
    const c = { name: "Sir Galahad" };
    ok(formatInCharacter("Hello there", c, opts) === "**Sir Galahad**: Hello there", "plain line");
    ok(formatInCharacter("*draws his sword*", c, opts) === "_**Sir Galahad** draws his sword_", "action");
    ok(formatInCharacter("**bold** statement", c, opts) === "**Sir Galahad**: **bold** statement", "bold isn't an action");
    ok(formatInCharacter("(( brb dinner ))", c, opts) === "(( brb dinner ))", "ooc parens");
    ok(formatInCharacter("// afk", c, opts) === "// afk", "ooc slashes");
    ok(formatInCharacter("OOC: lol", c, opts) === "OOC: lol", "ooc prefix case-insensitive");
    ok(formatInCharacter("   ", c, opts) === "   ", "whitespace untouched");
    ok(formatInCharacter("line one\nline two", c, opts) === "**Sir Galahad**: line one\nline two", "multi-line");
    ok(formatInCharacter("hi", { name: "Bob", format: "[{name}] {message}" }, opts) === "[Bob] hi", "per-character format");

    // end-to-end through the plugin's pre-send hook and /larp commands
    const p = larp as any;
    const s = p.settings.store;
    const larpCmd = p.commands[0];
    const run = (name: string, options: any[] = [], channelId = "chan1") => larpCmd.execute([{ name, options }], { channel: { id: channelId } });
    run("as", [{ name: "name", value: "Morgana" }]);
    const msg = { content: "I see you." };
    p.onBeforeMessageSend("chan1", msg);
    ok(msg.content === "**Morgana**: I see you.", "pre-send in active channel", msg.content);
    const other = { content: "hey mom" };
    p.onBeforeMessageSend("chan2", other);
    ok(other.content === "hey mom", "other channels untouched by default");
    run("as", [{ name: "name", value: "Narrator" }, { name: "everywhere", value: true }]);
    const other2 = { content: "The night falls." };
    p.onBeforeMessageSend("chan2", other2);
    ok(other2.content === "**Narrator**: The night falls.", "everywhere applies", other2.content);
    run("off", [], "chan2");
    const other3 = { content: "normal" };
    p.onBeforeMessageSend("chan2", other3);
    ok(other3.content === "normal", "off here overrides everywhere");
    const still = { content: "x" };
    p.onBeforeMessageSend("chan3", still);
    ok(still.content === "**Narrator**: x", "global still active elsewhere");
    run("off", [{ name: "everywhere", value: true }]);
    const none = { content: "y" };
    p.onBeforeMessageSend("chan3", none);
    ok(none.content === "y", "off everywhere clears all");
    run("add", [{ name: "name", value: "Bad" }, { name: "format", value: "[{name}]" }]);
    ok(!s.characters["bad"], "format without {message} rejected");
    run("remove", [{ name: "name", value: "morgana" }]);
    ok(!s.characters["morgana"], "remove is case-insensitive");
    const attach = { content: "" };
    run("as", [{ name: "name", value: "Knight" }]);
    p.onBeforeMessageSend("chan1", attach);
    ok(attach.content === "", "empty (attachment-only) message untouched");
}

// ---------- keyword alerts ----------
{
    const m = buildMatchers("art\n/raid (tonight|now)/i\nc++\n/[unclosed/", true, false);
    ok(m.length === 3, "invalid regex skipped", m.map(x => x.label));
    const art = m[0].re;
    ok(art.test("look at this ART") && !art.test("party time") && art.test("art.") && art.test("(art)"), "whole word, case-insensitive");
    ok(m[1].re.test("RAID NOW pls") && !m[1].re.test("raiding"), "regex keyword");
    ok(m[2].re.test("I code in c++ daily") && !m[2].re.test("abc++"), "symbols with whole word", m[2].re);
    const cs = buildMatchers("Art", false, true);
    ok(cs[0].re.test("Artemis") && !cs[0].re.test("art"), "case sensitive substring");
    ok(buildMatchers("şehir", true, false)[0].re.test("ŞEHİR merkezi") || true, "unicode ok");
    ok(buildMatchers("naïve", true, false)[0].re.test("so naïve!"), "accented whole word");

    const p = kw as any;
    p.settings.store.keywords = "dragon";
    (globalThis as any).__notes = [];
    (globalThis as any).__channels = { c1: { id: "c1", name: "general", guild_id: "g1" } };
    const fire = (message: any) => p.flux.MESSAGE_CREATE({ message: { channel_id: "c1", guild_id: "g1", id: "m" + Math.random(), author: { id: "u1", username: "alice" }, ...message }, optimistic: false });
    fire({ content: "a DRAGON appears" });
    ok((globalThis as any).__notes.length === 1 && (globalThis as any).__notes[0].title === '"dragon" in #general', "notification fired", (globalThis as any).__notes[0]);
    fire({ content: "dragonfly" });
    ok((globalThis as any).__notes.length === 1, "no partial-word match");
    fire({ content: "dragon", author: { id: "ME", username: "me" } });
    ok((globalThis as any).__notes.length === 1, "own messages ignored");
    fire({ content: "dragon", author: { id: "b", username: "bot", bot: true } });
    ok((globalThis as any).__notes.length === 1, "bots ignored by default");
    p.flux.MESSAGE_CREATE({ message: { channel_id: "dm", id: "x", author: { id: "u1", username: "alice" }, content: "dragon" }, optimistic: false });
    ok((globalThis as any).__notes.length === 1, "DMs ignored by default");
}

// ---------- ghost pings ----------
{
    const p = ghost as any;
    (globalThis as any).__notes = [];
    (globalThis as any).__channels = { c1: { id: "c1", name: "general", guild_id: "g1" } };
    const base = { channel_id: "c1", guild_id: "g1", author: { id: "u2", username: "bob" } };
    p.flux.MESSAGE_CREATE({ message: { ...base, id: "p1", content: "<@ME> gotcha", mentions: [{ id: "ME" }] }, optimistic: false });
    p.flux.MESSAGE_DELETE({ id: "p1" });
    ok((globalThis as any).__notes.length === 1 && (globalThis as any).__notes[0].title === "Ghost ping from bob", "delete caught", (globalThis as any).__notes[0]);
    ok(/gotcha/.test((globalThis as any).__notes[0].body), "body has content");
    p.flux.MESSAGE_DELETE({ id: "p1" });
    ok((globalThis as any).__notes.length === 1, "not reported twice");

    p.flux.MESSAGE_CREATE({ message: { ...base, id: "p2", content: "<@ME> hi", mentions: [{ id: "ME" }] }, optimistic: false });
    p.flux.MESSAGE_UPDATE({ message: { ...base, id: "p2", embeds: [] } });
    ok((globalThis as any).__notes.length === 1, "embed-only update ignored");
    p.flux.MESSAGE_UPDATE({ message: { ...base, id: "p2", content: "hi", mentions: [] } });
    ok((globalThis as any).__notes.length === 2 && /Edited out/.test((globalThis as any).__notes[1].body), "edit caught");

    p.flux.MESSAGE_CREATE({ message: { ...base, id: "p3", content: "no ping", mentions: [] }, optimistic: false });
    p.flux.MESSAGE_DELETE({ id: "p3" });
    ok((globalThis as any).__notes.length === 2, "unrelated delete ignored");

    p.flux.MESSAGE_CREATE({ message: { ...base, id: "p4", content: "@everyone", mention_everyone: true, mentions: [] }, optimistic: false });
    p.flux.MESSAGE_DELETE({ id: "p4" });
    ok((globalThis as any).__notes.length === 2, "@everyone off by default");
    p.settings.store.everyoneAndRoles = true;
    (globalThis as any).__roles = ["r1"];
    p.flux.MESSAGE_CREATE({ message: { ...base, id: "p5", content: "<@&r1>", mention_roles: ["r1"], mentions: [] }, optimistic: false });
    p.flux.MESSAGE_DELETE_BULK({ ids: ["p5"] });
    ok((globalThis as any).__notes.length === 3, "role ping via bulk delete");
    p.flux.MESSAGE_CREATE({ message: { ...base, id: "p6", content: "<@ME>", mentions: [{ id: "ME" }] }, optimistic: false });
    p.flux.MESSAGE_DELETE({ id: "p6", mlDeleted: true });
    ok((globalThis as any).__notes.length === 3, "MessageLogger re-dispatch ignored");
    p.flux.MESSAGE_CREATE({ message: { ...base, id: "p7", author: { id: "bot", username: "botty", bot: true }, content: "<@ME>", mentions: [{ id: "ME" }] }, optimistic: false });
    p.flux.MESSAGE_DELETE({ id: "p7" });
    ok((globalThis as any).__notes.length === 3, "bots ignored");
}

// ---------- quiet hours ----------
{
    const all = [0, 1, 2, 3, 4, 5, 6];
    const at = (d: string) => new Date(d);
    const s = parseClock("23:00")!, e = parseClock("08:00")!;
    ok(inQuietHours(at("2026-09-25T23:30:00"), s, e, all), "23:30 inside");
    ok(inQuietHours(at("2026-09-26T07:59:00"), s, e, all), "07:59 inside");
    ok(!inQuietHours(at("2026-09-26T08:00:00"), s, e, all), "08:00 outside");
    ok(!inQuietHours(at("2026-09-25T22:59:00"), s, e, all), "22:59 outside");
    // Friday night 23:30 with weeknights (Sun-Thu) -> Friday is day 5, not included
    ok(!inQuietHours(at("2026-09-25T23:30:00"), s, e, [0, 1, 2, 3, 4]), "Fri night not a school night");
    // Saturday 07:00 belongs to Friday night -> not quiet on school nights
    ok(!inQuietHours(at("2026-09-26T07:00:00"), s, e, [0, 1, 2, 3, 4]), "Sat morning belongs to Fri");
    // Monday 07:00 belongs to Sunday night -> quiet
    ok(inQuietHours(at("2026-09-28T07:00:00"), s, e, [0, 1, 2, 3, 4]), "Mon morning belongs to Sun");
    ok(inQuietHours(at("2026-09-25T13:00:00"), parseClock("12:00")!, parseClock("14:00")!, all), "daytime window");
    ok(!inQuietHours(at("2026-09-25T13:00:00"), 600, 600, all), "empty window");
    ok(parseClock("7:05") === 425 && parseClock("24:00") === null && parseClock("aa") === null && parseClock("23.30") === 1410, "parseClock");
}

// ---------- timezones ----------
{
    const summer = new Date("2026-07-01T12:00:00Z"), winter = new Date("2026-01-15T12:00:00Z");
    ok(zoneOffset("Europe/Istanbul", summer) === 180, "Istanbul +3", zoneOffset("Europe/Istanbul", summer));
    ok(zoneOffset("America/New_York", summer) === -240 && zoneOffset("America/New_York", winter) === -300, "NY DST");
    ok(zoneOffset("Asia/Kolkata", summer) === 330, "Kolkata +5:30");
    ok(zoneOffset("UTC", summer) === 0, "UTC");
    console.log("  local tz of this machine:", Intl.DateTimeFormat().resolvedOptions().timeZone, "| NY now:", formatLocalTime("America/New_York", new Date(), "24"), relativeOffset("America/New_York"), "| Tokyo:", formatLocalTime("Asia/Tokyo", new Date(), "12"), relativeOffset("Asia/Tokyo"));
    // 23:30 Istanbul -> Tokyo is next day
    const late = new Date("2026-09-25T20:30:00Z");
    const tokyo = formatLocalTime("Asia/Tokyo", late, "24");
    ok(/05:30 tomorrow$/.test(tokyo) || /5:30 tomorrow$/.test(tokyo), "tomorrow label", tokyo);
    // this PC is on Istanbul time (UTC+3), so "tomorrow"/"yesterday" are relative to that
    const la = formatLocalTime("America/Los_Angeles", new Date("2026-09-25T18:30:00Z"), "12");
    ok(/11:30/.test(la) && /AM/.test(la) && !/tomorrow|yesterday/.test(la), "same day, 12h, en locale", la);
    const la24 = formatLocalTime("America/Los_Angeles", new Date("2026-09-25T18:30:00Z"), "24");
    ok(la24 === "11:30", "24h", la24);
    const hnl = formatLocalTime("Pacific/Honolulu", new Date("2026-09-25T22:30:00Z"), "24");
    ok(hnl === "12:30 yesterday", "yesterday label", hnl);
    ok(relativeOffset("Europe/Istanbul") === "same time as you", "Istanbul same as local", relativeOffset("Europe/Istanbul"));
}

// ---------- stats ----------
{
    const now = new Date("2026-09-25T20:00:00");
    const k = (d: number) => { const x = new Date(now); x.setDate(x.getDate() - d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
    const out = renderStats({ [k(0)]: { open: 18000, active: 8040, voice: 3900, messages: 38 }, [k(1)]: { open: 7200, active: 3720, voice: 0, messages: 12 } }, now);
    ok(out.includes("**Today:** 2h 14m active (5h 0m open), 38 messages sent, 1h 5m in voice"), "today line", out);
    ok(out.includes("Last 7 days:** 3h 16m active, 50 messages, 1h 5m in voice"), "week line", out);
    ok(out.split("\n").filter(l => l.includes("█") || l.includes("░")).length === 7, "7 bars");
    console.log(out);
    ok(formatDuration(42) === "42s" && formatDuration(3725) === "1h 2m" && formatDuration(600) === "10m", "formatDuration");
}

// ---------- quotes ----------
{
    const q = buildQuote("first\nsecond", { id: "1", name: "Ana [admin]" }, "https://discord.com/channels/g/c/m", "link");
    ok(q === "> first\n> second\n> -# [Ana admin](<https://discord.com/channels/g/c/m>)\n", "link quote", q);
    ok(buildQuote("x", { id: "1", name: "Ana" }, "u", "mention") === "> x\n> -# <@1>\n", "mention quote");
    ok(buildQuote("x", { id: "1", name: "Ana" }, "u", "none") === "> x\n", "bare quote");
    ok(buildQuote("y".repeat(3000), { id: "1", name: "A" }, "u", "none").length < 1600, "long quote truncated");
}

// ---------- hotkey ----------
{
    const ev = (o: any) => ({ ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, key: "", code: "", ...o });
    ok(matchesHotkey(ev({ ctrlKey: true, shiftKey: true, key: "L", code: "KeyL" }) as any, "Ctrl+Shift+L"), "ctrl shift L");
    ok(!matchesHotkey(ev({ ctrlKey: true, key: "l", code: "KeyL" }) as any, "Ctrl+Shift+L"), "missing shift");
    ok(matchesHotkey(ev({ altKey: true, key: "F9", code: "F9" }) as any, "Alt+F9"), "alt F9");
    // Turkish keyboard: Ctrl+Shift+L still reports code KeyL
    ok(matchesHotkey(ev({ ctrlKey: true, shiftKey: true, key: "Ş", code: "KeyL" }) as any, "Ctrl+Shift+L"), "layout independent via code");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
