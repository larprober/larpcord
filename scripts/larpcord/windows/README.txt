Larpcord for Windows
====================

Install
  1. Extract this whole zip somewhere (right-click, Extract All).
  2. Double-click "Install Larpcord.cmd".
     If Discord is open it asks to close it, then installs and starts Discord again.
  3. In Discord, open Settings. There's a new "Larpcord" section with the plugins.

  Windows may warn that the file came from the internet. Choose "More info",
  then "Run anyway". The installer is a plain PowerShell script (install.ps1),
  so you can open it in Notepad and read exactly what it does first.

Uninstall
  Double-click "Uninstall Larpcord.cmd". If you had another client mod before
  Larpcord and its files are still there, that comes back; otherwise Discord
  goes back to normal. Your Larpcord settings stay in %APPDATA%\Larpcord.

After a Discord update
  Larpcord re-applies itself when Discord updates. If the Larpcord section ever
  disappears from Settings, run "Install Larpcord.cmd" again.

What gets changed
  - Larpcord's files are copied to %APPDATA%\Larpcord\dist
  - In Discord's newest version folder (%LOCALAPPDATA%\Discord\app-x.y.z\resources)
    Discord's app.asar is renamed to _app.asar and a small app.asar that loads
    Larpcord takes its place. Nothing else is touched.

Good to know
  Client mods are against Discord's Terms of Service. Discord hasn't been known
  to ban people for them, but use Larpcord at your own risk.

License
  Larpcord is free software under the GNU General Public License v3.0 or later,
  see LICENSE.txt. The full source code is available from the same place you
  downloaded this zip.
