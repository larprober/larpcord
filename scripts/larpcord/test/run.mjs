// Bundles the Larpcord plugins with Discord/Vencord runtime modules stubbed out,
// so their pure logic can be tested in plain Node.
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { tmpdir } from "os";
import { pathToFileURL } from "url";



const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");
const { build } = createRequire(join(repo, "package.json"))("esbuild");
const out = join(tmpdir(), "larpcord-logic-test.mjs");

const stub = `
const any = new Proxy(function(){}, { get: (t, k) => k === Symbol.toPrimitive ? () => "" : any, apply: () => any, construct: () => any });
export default function definePlugin(p) { return p; }
export const OptionType = { STRING:0, NUMBER:1, BIGINT:2, BOOLEAN:3, SELECT:4, SLIDER:5, COMPONENT:6, CUSTOM:7 };
export const Devs = { Larpcord: { name: "Larpcord", id: 0n } };
export const ApplicationCommandInputType = { BUILT_IN: 0, BUILT_IN_TEXT: 1 };
export const ApplicationCommandOptionType = { SUB_COMMAND: 1, STRING: 3, BOOLEAN: 5, USER: 6 };
export function findOption(args, name, fb) { return args.find(a => a.name === name)?.value ?? fb; }
export const sendBotMessage = (c, m) => (globalThis.__bot ??= []).push(m.content);
export function definePluginSettings(def) {
  const store = {};
  for (const [k, v] of Object.entries(def)) {
    if ("default" in v) store[k] = structuredClone(v.default);
    else if (v.options) store[k] = v.options.find(o => o.default)?.value;
  }
  return { store, def, use: () => store };
}
export const classNameFactory = p => (...a) => a.map(x => p + x).join(" ");
export const getUserSettingLazy = () => ({ getSetting: () => globalThis.__status ?? "online", updateSetting: async v => { globalThis.__status = v; } });
export const get = async () => undefined, set = async () => {}, update = async () => {};
export const showNotification = n => (globalThis.__notes ??= []).push(n);
export const React = { useSyncExternalStore: (s, g) => g() };
export const useState = v => [v, () => {}], useMemo = f => f();
export const ChatBarButton = any, Button = any, Flex = any, HeadingSecondary = any, Paragraph = any;
export const ContextMenuApi = any, Menu = any, Modal = any, openModal = any, TextInput = any, SearchableSelect = any, Tooltip = any;
export const NavigationRouter = any, showToast = () => {}, Toasts = { Type: {} };
export const ChannelStore = { getChannel: id => globalThis.__channels?.[id] };
export const GuildStore = { getGuild: () => null };
export const GuildMemberStore = { getMember: () => ({ roles: globalThis.__roles ?? [] }) };
export const UserStore = { getCurrentUser: () => ({ id: "ME" }), getUser: () => null };
export const SelectedChannelStore = { getChannelId: () => null, getVoiceChannelId: () => null };
export const LocaleStore = { locale: "en-US" };
export const UserGuildSettingsStore = { isMuted: () => false, isChannelMuted: () => false };
export const copyWithToast = any, insertTextIntoChatInputBox = any;
`;

await build({
    entryPoints: [join(here, "logic.test.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: out,
    jsx: "transform",
    jsxFactory: "__h",
    banner: { js: "const __h = () => null;" },
    loader: { ".css": "empty" },
    plugins: [{
        name: "stubs",
        setup(b) {
            b.onResolve({ filter: /^(@api|@utils|@webpack|@components|@vencord)\b/ }, () => ({ path: "stub", namespace: "stub" }));
            b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: stub, loader: "js" }));
        }
    }],
    absWorkingDir: repo,
    logLevel: "warning"
});
await import(pathToFileURL(out).href);
