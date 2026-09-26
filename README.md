# Larpcord

Larpcord is a Discord client mod with 167 built-in plugins, themes and a QuickCSS editor. Ten of the plugins are made for people who roleplay, run tabletop games, or just live in Discord too much.

It runs on Discord for Windows, and on Android through the Larpcord app.

## The Larpcord plugins

In settings, open **Plugins** and pick **Show Larpcord Exclusives** from the filter menu. They're also marked with a LARPCORD badge.

| Plugin | What it does | On by default |
| --- | --- | --- |
| **LarpMode** | Speak as a character. Pick a persona per channel from the mask button in the chat bar or with `/larp as`. `Hello` goes out as **Sir Galahad**: Hello, `*draws sword*` becomes an action, and lines starting with `((` or `//` go out of character, unchanged. Custom formats per character. | yes |
| **DiceRoller** | `/roll 2d20kh1+5`, `4d6dl1`, `6x4d6dl1` for a full stat block, `d20 adv`, `d%`, with a reason label, dropped dice struck out and natural 1s and 20s called out. Secret rolls only you see. `/pick` chooses between options. Uses the system's cryptographic RNG. | yes |
| **TextEffects** | `/fx` in mocking case, owo, vaporwave, small caps, script, gothic, monospace, bubbles, upside down, reversed, spaced or zalgo. Mentions, custom emoji and links keep working. | yes |
| **Timezones** | Right-click someone and choose Set time zone, and their local time appears next to their name in chat ("4:22 AM tomorrow"), with the offset from you on hover. `/time` lists everyone. | yes |
| **GhostPingDetector** | When someone pings you and deletes or edits the message to hide it, you get a notification with who it was and what they said. `/ghostpings` shows past ones. | yes |
| **QuoteTools** | Quote and Copy as quote in the message menu. Highlight part of a message first to quote just that part. Works across channels and servers. | yes |
| **SessionStats** | Screen time for Discord: active time, time in voice and messages sent per day. `/stats` shows the last week as a bar chart. Optional daily reminder. | yes |
| **KeywordAlerts** | Get notified when a word, phrase or `/regex/` comes up in any server, including channels you don't have open. `/keywords add`, `/keywords hits`. | off |
| **PrivacyBlur** | Blurs Discord when you tab away, after you go idle, or on Ctrl+Shift+L, so people near your screen can't read your chats. | off |
| **QuietHours** | Switches you to Do Not Disturb, idle or invisible on a schedule (say 23:00 to 08:00, or weeknights only) and puts your old status back afterwards. | off |

None of these patch Discord's internal code. They're built on the mod's plugin APIs (commands, message events, context menus, flux events), so a Discord update is unlikely to break them.

## Building and installing (Windows)

You need [Node.js](https://nodejs.org) 22 or newer, [pnpm](https://pnpm.io) and git.

```sh
pnpm install --frozen-lockfile
pnpm build
```

Quit Discord from the tray icon, then:

```sh
node scripts/larpcord/install.mjs
```

Start Discord again. Settings now has a **Larpcord** section.

To go back to what you had before, quit Discord and run the command below. It restores your previous mod if its files are still on disk, and plain Discord otherwise.

```sh
node scripts/larpcord/install.mjs --uninstall
```

Add `--ptb`, `--canary` or `--all` for other Discord branches. Larpcord re-applies itself when Discord updates. If Settings ever loses its Larpcord section after a Discord update, quit Discord and run the install script again.

Start Discord the normal way (Start menu, desktop or taskbar). If you launch it from a sandboxed program, like a terminal inside a packaged Microsoft Store app, Windows may redirect Discord's updater writes into that app's private storage. The updater then reinstalls over the loader and can leave a Start-menu shortcut pointing at the sandbox.

After changing code, run `pnpm build` and press Ctrl+R in Discord to reload.

## Making a release

```sh
node scripts/larpcord/release.mjs
```

This writes everything to `release/`:

- `LarpcordSetup.exe`, the Windows installer, with the mod embedded. It's compiled with the C# compiler that comes with Windows, so nothing extra is needed. It isn't code-signed, so Windows SmartScreen warns about it the first time it runs.
- `larpcord.apk`, the Android app from `../larpcord-android`. It's signed with the key in that folder's `keystore/`; keep that key, since updates need the same one.
- `larpcord.user.js` for Tampermonkey.
- `larpcord-source.zip`, the full source of all of the above. The GPL requires offering it next to the downloads. The Android signing key is left out.
- `site/`, the static website with all the downloads in `site/downloads/`.

The website is live at https://larprober.github.io/larpcord/. GitHub Pages serves it from this repository's `gh-pages` branch, which holds only the built site. To publish a new version after running the release script:

```sh
git worktree add ../larpcord-pages gh-pages
cp -r release/site/. ../larpcord-pages/
cd ../larpcord-pages
git add -A
git commit -m "Website <version>"
git push
cd ../larpcord
git worktree remove ../larpcord-pages
```

GitHub rebuilds the page within a minute or so.

## Where things live

- `src/larpcordplugins/` holds the Larpcord plugins, one folder each. `_lib.ts` has shared helpers.
- Settings, QuickCSS and themes: `%APPDATA%\Larpcord`
- Plugin data (keyword hits, ghost ping log, time zones, stats) is stored in Discord's IndexedDB.

## License

Larpcord is free software under the GNU General Public License v3.0 or later (see [LICENSE](LICENSE)). It is a modified version of Vencord, copyright Vendicated and contributors; the copyright notices in the source files are kept as the license requires. Anyone you give a Larpcord build to is entitled to this source code.

Client mods are against Discord's Terms of Service. Discord hasn't been known to ban people for them, but use Larpcord at your own risk.
