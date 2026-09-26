// Tiny Chrome DevTools Protocol client for poking at a running Discord page
// (desktop Discord started with --remote-debugging-port, or the Android app's
// debug build through `adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`).
//   CDP_PORT=9223 node cdp.mjs eval "<js expression>"
//   node cdp.mjs shot out.png [x y w h]
//   node cdp.mjs watch 15        reload, then print exceptions and console errors for 15 s
import { writeFileSync } from "fs";

const port = process.env.CDP_PORT || 9223;
const [, , cmd, ...rest] = process.argv;
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = targets.find(t => t.type === "page" && t.url.startsWith("https://discord.com"));
if (!page) throw new Error("Discord page not found");

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const pending = new Map();
const events = [];
ws.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
    } else if (msg.method) {
        events.push(msg);
    }
};
const send = (method, params = {}) => new Promise(res => {
    const n = ++id;
    pending.set(n, res);
    ws.send(JSON.stringify({ id: n, method, params }));
});

if (cmd === "eval") {
    const r = await send("Runtime.evaluate", { expression: rest.join(" "), awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) console.log("EXCEPTION:", JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text));
    else console.log(typeof r.result?.result?.value === "string" ? r.result.result.value : JSON.stringify(r.result?.result?.value, null, 1));
} else if (cmd === "shot") {
    const [file, x, y, w, h] = rest;
    const params = { format: "png" };
    if (w) params.clip = { x: +x, y: +y, width: +w, height: +h, scale: 1 };
    const r = await send("Page.captureScreenshot", params);
    writeFileSync(file, Buffer.from(r.result.data, "base64"));
    console.log("saved", file);
} else if (cmd === "watch") {
    await send("Runtime.enable");
    await send("Page.enable");
    events.length = 0;
    await send("Page.reload", { ignoreCache: true });
    await new Promise(r => setTimeout(r, Number(rest[0] || 15) * 1000));
    for (const e of events) {
        if (e.method === "Runtime.exceptionThrown") {
            const d = e.params.exceptionDetails;
            console.log("EXCEPTION", (d.exception?.description ?? d.text).slice(0, 600), "@", d.url ?? "", d.lineNumber, d.columnNumber);
        } else if (e.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(e.params.type)) {
            console.log(e.params.type.toUpperCase(), e.params.args.map(a => a.value ?? a.description ?? "").join(" ").slice(0, 400));
        } else if (e.method === "Runtime.consoleAPICalled" && /Larpcord/.test(JSON.stringify(e.params.args).slice(0, 300))) {
            console.log("LOG", e.params.args.map(a => a.value ?? a.description ?? "").join(" ").replace(/%c|background:[^;]*;|color:[^;]*;|font-weight:[^;]*;|border-radius:[^;]*;/g, "").slice(0, 200));
        }
    }
}
ws.close();
