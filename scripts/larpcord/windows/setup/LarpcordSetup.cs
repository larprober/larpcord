// Larpcord, a Discord client mod
// Copyright (c) 2026 Larpcord contributors
// SPDX-License-Identifier: GPL-3.0-or-later
//
// LarpcordSetup.exe: installs Larpcord into the Discord desktop app, or removes it again.
// Built with the C# compiler that ships with the .NET Framework (C# 5), so no SDK is needed:
// see scripts/larpcord/release.mjs. The Larpcord files are embedded as "payload/..." resources.
//
// Test switches (no window): --install | --uninstall --quiet [--discord-root DIR]
//   [--install-dir DIR] [--no-process-check] [--no-launch] [--log FILE]
//   --render FILE.png draws the window to an image and exits.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("Larpcord Setup")]
[assembly: AssemblyDescription("Installs Larpcord into the Discord desktop app")]
[assembly: AssemblyCompany("Larpcord contributors")]
[assembly: AssemblyProduct("Larpcord")]
[assembly: AssemblyCopyright("Free software under the GPL-3.0 or later")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

namespace Larpcord.Setup
{
    sealed class DiscordInstall
    {
        public string Branch;
        public string Base;
        public string AppDir;
        public string Version;

        public string Resources { get { return Path.Combine(AppDir, "resources"); } }
        public string AppAsar { get { return Path.Combine(Resources, "app.asar"); } }

        public string Label
        {
            get
            {
                string name = Branch == "DiscordPTB" ? "Discord PTB" : Branch == "DiscordCanary" ? "Discord Canary" : "Discord";
                return name + " " + Version;
            }
        }
    }

    static class Installer
    {
        public const string Marker = "larpcord-shim";
        public const string BackupName = "app.asar.before-larpcord";
        static readonly string[] Branches = { "Discord", "DiscordPTB", "DiscordCanary" };
        static readonly Encoding Utf8 = new UTF8Encoding(false);

        public static string DiscordRoot = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        public static string InstallDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Larpcord", "dist");

        // Newest app-x.y.z folder per branch whose resources are complete
        public static List<DiscordInstall> Find()
        {
            var found = new List<DiscordInstall>();
            foreach (string branch in Branches)
            {
                string baseDir = Path.Combine(DiscordRoot, branch);
                if (!Directory.Exists(baseDir)) continue;
                DirectoryInfo best = null;
                Version bestVersion = null;
                foreach (DirectoryInfo dir in new DirectoryInfo(baseDir).GetDirectories("app-*"))
                {
                    Match m = Regex.Match(dir.Name, @"^app-(\d+\.\d+\.\d+)$");
                    if (!m.Success) continue;
                    string res = Path.Combine(dir.FullName, "resources");
                    if (!File.Exists(Path.Combine(res, "app.asar")) && !File.Exists(Path.Combine(res, "_app.asar"))) continue;
                    var v = new Version(m.Groups[1].Value);
                    if (bestVersion == null || v > bestVersion) { best = dir; bestVersion = v; }
                }
                if (best != null)
                    found.Add(new DiscordInstall { Branch = branch, Base = baseDir, AppDir = best.FullName, Version = bestVersion.ToString() });
            }
            return found;
        }

        // Mod loaders are a few hundred bytes; Discord's real app.asar is megabytes.
        public static bool IsLoader(string path) { return File.Exists(path) && new FileInfo(path).Length < 65536; }
        public static bool IsOurs(string path) { return IsLoader(path) && File.ReadAllText(path, Utf8).Contains(Marker); }

        public static string LoaderTarget(string path)
        {
            Match m = Regex.Match(File.ReadAllText(path, Utf8), "require\\((\"(?:[^\"\\\\]|\\\\.)*\")\\)");
            return m.Success ? JsonUnquote(m.Groups[1].Value) : null;
        }

        static string JsonUnquote(string literal)
        {
            var sb = new StringBuilder();
            for (int i = 1; i < literal.Length - 1; i++)
            {
                char c = literal[i];
                if (c != '\\') { sb.Append(c); continue; }
                char n = literal[++i];
                if (n == 'u') { sb.Append((char)Convert.ToInt32(literal.Substring(i + 1, 4), 16)); i += 4; }
                else if (n == 'n') sb.Append('\n');
                else if (n == 't') sb.Append('\t');
                else if (n == 'r') sb.Append('\r');
                else sb.Append(n);
            }
            return sb.ToString();
        }

        static string JsonQuote(string s)
        {
            var sb = new StringBuilder("\"");
            foreach (char c in s)
            {
                if (c == '"' || c == '\\') sb.Append('\\').Append(c);
                else if (c < 0x20) sb.AppendFormat("\\u{0:x4}", (int)c);
                else sb.Append(c);
            }
            return sb.Append('"').ToString();
        }

        public static string Describe(DiscordInstall d)
        {
            if (IsOurs(d.AppAsar)) return "Larpcord is installed";
            if (IsLoader(d.AppAsar)) return "another mod is installed";
            return "no mods";
        }

        // A minimal asar archive holding index.js + package.json (Chromium Pickle framing)
        public static byte[] LoaderBytes(string patcherPath)
        {
            byte[] index = Utf8.GetBytes("// " + Marker + "\nrequire(" + JsonQuote(patcherPath) + ");\n");
            byte[] pkg = Utf8.GetBytes("{\"name\":\"discord\",\"main\":\"index.js\"}");
            byte[] json = Utf8.GetBytes("{\"files\":{\"index.js\":{\"size\":" + index.Length + ",\"offset\":\"0\"}," +
                "\"package.json\":{\"size\":" + pkg.Length + ",\"offset\":\"" + index.Length + "\"}}}");
            int padded = (json.Length + 3) / 4 * 4;
            using (var ms = new MemoryStream())
            {
                var w = new BinaryWriter(ms);
                w.Write((uint)4);
                w.Write((uint)(8 + padded));
                w.Write((uint)(4 + padded));
                w.Write((uint)json.Length);
                w.Write(json);
                w.Write(new byte[padded - json.Length]);
                w.Write(index);
                w.Write(pkg);
                w.Flush();
                return ms.ToArray();
            }
        }

        static void CopyPayload()
        {
            Directory.CreateDirectory(InstallDir);
            Assembly asm = Assembly.GetExecutingAssembly();
            foreach (string name in asm.GetManifestResourceNames())
            {
                if (!name.StartsWith("payload/")) continue;
                using (Stream src = asm.GetManifestResourceStream(name))
                using (FileStream dst = File.Create(Path.Combine(InstallDir, name.Substring("payload/".Length))))
                    src.CopyTo(dst);
            }
        }

        public static List<string> Install(List<DiscordInstall> found)
        {
            var log = new List<string>();
            CopyPayload();
            string patcher = Path.Combine(InstallDir, "patcher.js");
            foreach (DiscordInstall d in found)
            {
                string original = Path.Combine(d.Resources, "_app.asar");
                string backup = Path.Combine(d.Resources, BackupName);
                if (IsLoader(d.AppAsar))
                {
                    // Another mod (or an older Larpcord). Keep its loader so uninstalling can bring it back.
                    if (!File.Exists(original))
                    {
                        log.Add(d.Label + ": skipped. Discord's own files are missing here, reinstall Discord first.");
                        continue;
                    }
                    if (!IsOurs(d.AppAsar) && !File.Exists(backup)) File.Move(d.AppAsar, backup);
                }
                else if (File.Exists(d.AppAsar))
                {
                    // Discord's real code. It's the freshest copy, so any leftover _app.asar is stale.
                    if (File.Exists(original)) File.Delete(original);
                    File.Move(d.AppAsar, original);
                }
                File.WriteAllBytes(d.AppAsar, LoaderBytes(patcher));
                log.Add(d.Label + ": Larpcord installed.");
            }
            return log;
        }

        public static List<string> Uninstall(List<DiscordInstall> found)
        {
            var log = new List<string>();
            foreach (DiscordInstall d in found)
            {
                string original = Path.Combine(d.Resources, "_app.asar");
                string backup = Path.Combine(d.Resources, BackupName);
                if (!File.Exists(original) || !IsOurs(d.AppAsar))
                {
                    log.Add(d.Label + ": Larpcord isn't installed here.");
                    continue;
                }
                string previous = File.Exists(backup) ? LoaderTarget(backup) : null;
                File.Delete(d.AppAsar);
                if (previous != null && File.Exists(previous))
                {
                    File.Move(backup, d.AppAsar);
                    log.Add(d.Label + ": put back the mod you had before.");
                }
                else
                {
                    File.Move(original, d.AppAsar);
                    if (File.Exists(backup)) File.Delete(backup);
                    log.Add(d.Label + ": back to plain Discord.");
                }
            }
            if (Directory.Exists(InstallDir)) Directory.Delete(InstallDir, true);
            return log;
        }

        public static Process[] Running()
        {
            return Branches.SelectMany(b => Process.GetProcessesByName(b)).ToArray();
        }

        public static List<string> StopDiscord()
        {
            var names = new List<string>();
            foreach (Process p in Running())
            {
                try
                {
                    if (!names.Contains(p.ProcessName)) names.Add(p.ProcessName);
                    p.Kill();
                }
                catch (Exception) { }
            }
            // Wait until the files are free again
            for (int i = 0; i < 60 && Running().Length > 0; i++) Thread.Sleep(100);
            if (names.Count > 0) Thread.Sleep(700);
            return names;
        }

        public static void Launch(DiscordInstall d)
        {
            string update = Path.Combine(d.Base, "Update.exe");
            if (File.Exists(update)) Process.Start(update, "--processStart " + d.Branch + ".exe");
        }
    }

    sealed class D20Mark : Control
    {
        static readonly float C30 = (float)Math.Cos(Math.PI / 6);
        static readonly PointF PTop = new PointF(12, 2), UR = new PointF(12 + 10 * C30, 7), LR = new PointF(12 + 10 * C30, 17),
            PBottom = new PointF(12, 22), LL = new PointF(12 - 10 * C30, 17), UL = new PointF(12 - 10 * C30, 7),
            T = new PointF(12, 7.4f), BL = new PointF(12 - 4.6f * C30, 14.3f), BR = new PointF(12 + 4.6f * C30, 14.3f);

        static readonly object[][] Facets =
        {
            new object[] { new[] { PTop, UL, T }, "#EBB35A" }, new object[] { new[] { PTop, T, UR }, "#CB8C32" },
            new object[] { new[] { UL, BL, T }, "#DDA048" }, new object[] { new[] { UR, T, BR }, "#B47420" },
            new object[] { new[] { UL, LL, BL }, "#BB7C28" }, new object[] { new[] { LL, PBottom, BL }, "#99621A" },
            new object[] { new[] { BL, PBottom, BR }, "#C28530" }, new object[] { new[] { BR, PBottom, LR }, "#865414" },
            new object[] { new[] { UR, BR, LR }, "#774A11" }, new object[] { new[] { T, BL, BR }, "#F6CD7C" },
        };

        public D20Mark()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.Clear(BackColor);
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            float scale = Math.Min(Width, Height) / 21f;
            e.Graphics.TranslateTransform((Width - 24 * scale) / 2, -1.5f * scale);
            e.Graphics.ScaleTransform(scale, scale);
            foreach (object[] f in Facets)
                using (var brush = new SolidBrush(ColorTranslator.FromHtml((string)f[1])))
                    e.Graphics.FillPolygon(brush, (PointF[])f[0]);
            using (var pen = new Pen(Color.FromArgb(140, 42, 26, 7), 0.35f))
            {
                pen.LineJoin = LineJoin.Round;
                e.Graphics.DrawPolygon(pen, new[] { PTop, UR, LR, PBottom, LL, UL });
                foreach (object[] f in Facets) e.Graphics.DrawPolygon(pen, (PointF[])f[0]);
            }
        }
    }

    sealed class SetupForm : Form
    {
        static readonly Color Ground = ColorTranslator.FromHtml("#110F0C");
        static readonly Color PanelColor = ColorTranslator.FromHtml("#19150F");
        static readonly Color LineColor = ColorTranslator.FromHtml("#342B21");
        static readonly Color TextColor = ColorTranslator.FromHtml("#EEE5D5");
        static readonly Color Muted = ColorTranslator.FromHtml("#A69783");
        static readonly Color Faint = ColorTranslator.FromHtml("#7F7263");
        static readonly Color Gold = ColorTranslator.FromHtml("#E0A84F");
        static readonly Color OnGold = ColorTranslator.FromHtml("#1C1307");
        static readonly Color Fail = ColorTranslator.FromHtml("#D9775A");

        readonly Label status;
        readonly Label result;
        readonly Button installButton;
        readonly Button uninstallButton;
        List<DiscordInstall> found = new List<DiscordInstall>();

        public SetupForm()
        {
            Text = "Larpcord Setup";
            AutoScaleMode = AutoScaleMode.Dpi;
            AutoScaleDimensions = new SizeF(96f, 96f);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(520, 404);
            BackColor = Ground;
            ForeColor = TextColor;
            Font = new Font("Segoe UI", 10f);
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch (Exception) { }

            Controls.Add(new D20Mark { BackColor = Ground, Location = new Point(28, 26), Size = new Size(58, 58) });
            Controls.Add(new Label { Text = "Larpcord", Font = new Font("Georgia", 24f, FontStyle.Bold), AutoSize = true, Location = new Point(96, 24) });
            Controls.Add(new Label { Text = "Version " + Program.Version + " for the Discord desktop app", ForeColor = Muted, AutoSize = true, Location = new Point(99, 66) });
            Controls.Add(new Panel { BackColor = LineColor, Location = new Point(28, 106), Size = new Size(464, 1) });

            Controls.Add(new Label { Text = "On this PC", ForeColor = Faint, Font = new Font("Segoe UI", 9f), AutoSize = true, Location = new Point(28, 122) });
            status = new Label { Location = new Point(28, 144), Size = new Size(464, 64), ForeColor = TextColor };
            Controls.Add(status);

            installButton = MakeButton("Install", true, new Point(28, 220), new Size(150, 42));
            uninstallButton = MakeButton("Uninstall", false, new Point(190, 220), new Size(130, 42));
            installButton.Click += delegate { Run(false); };
            uninstallButton.Click += delegate { Run(true); };
            Controls.Add(installButton);
            Controls.Add(uninstallButton);

            result = new Label { Location = new Point(28, 280), Size = new Size(464, 84), ForeColor = TextColor };
            Controls.Add(result);

            Controls.Add(new Label
            {
                Text = "Free software under the GPL-3.0 or later. Not affiliated with Discord.",
                ForeColor = Faint, Font = new Font("Segoe UI", 8.5f), AutoSize = true, Location = new Point(28, 374)
            });

            RefreshStatus();
        }

        Button MakeButton(string text, bool primary, Point location, Size size)
        {
            var b = new Button
            {
                Text = text, Location = location, Size = size, FlatStyle = FlatStyle.Flat, Cursor = Cursors.Hand,
                Font = new Font("Segoe UI", 10.5f, primary ? FontStyle.Bold : FontStyle.Regular),
                UseVisualStyleBackColor = false
            };
            b.FlatAppearance.BorderSize = 1;
            Action style = delegate
            {
                if (!b.Enabled) { b.BackColor = PanelColor; b.ForeColor = Faint; b.FlatAppearance.BorderColor = LineColor; return; }
                b.BackColor = primary ? Gold : PanelColor;
                b.ForeColor = primary ? OnGold : TextColor;
                b.FlatAppearance.BorderColor = primary ? Gold : LineColor;
            };
            b.FlatAppearance.MouseOverBackColor = primary ? ColorTranslator.FromHtml("#E9B560") : ColorTranslator.FromHtml("#221C15");
            b.FlatAppearance.MouseDownBackColor = primary ? ColorTranslator.FromHtml("#D39A42") : ColorTranslator.FromHtml("#2A231A");
            b.EnabledChanged += delegate { style(); };
            style();
            return b;
        }

        public void RefreshStatus()
        {
            found = Installer.Find();
            if (found.Count == 0)
                status.Text = "Discord for Windows isn't installed. Install it from discord.com, then run this again.";
            else
                status.Text = string.Join("\n", found.Select(d => d.Label + ": " + Installer.Describe(d)).ToArray());
            installButton.Enabled = found.Count > 0;
            uninstallButton.Enabled = found.Any(d => Installer.IsOurs(d.AppAsar));
        }

        void Run(bool uninstall)
        {
            if (Installer.Running().Length > 0)
            {
                DialogResult answer = MessageBox.Show(this, "Discord has to close for this, and it will start again afterwards. Close it now?",
                    "Larpcord Setup", MessageBoxButtons.OKCancel, MessageBoxIcon.Question);
                if (answer != DialogResult.OK) return;
            }
            UseWaitCursor = true;
            installButton.Enabled = uninstallButton.Enabled = false;
            result.ForeColor = TextColor;
            result.Text = uninstall ? "Removing Larpcord..." : "Installing...";
            result.Refresh();
            try
            {
                List<string> wasRunning = Installer.StopDiscord();
                List<string> log = uninstall ? Installer.Uninstall(found) : Installer.Install(found);
                List<DiscordInstall> launch = wasRunning.Count > 0
                    ? found.Where(d => wasRunning.Contains(d.Branch)).ToList()
                    : (uninstall ? new List<DiscordInstall>() : found.Take(1).ToList());
                foreach (DiscordInstall d in launch) Installer.Launch(d);
                log.Add(uninstall
                    ? "Done."
                    : "Done. Open Discord's settings and you'll find a Larpcord section.");
                result.Text = string.Join("\n", log.ToArray());
            }
            catch (Exception e)
            {
                result.ForeColor = Fail;
                result.Text = "That didn't work: " + e.Message;
            }
            finally
            {
                UseWaitCursor = false;
                RefreshStatus();
            }
        }
    }

    static class Program
    {
        public const string Version = "1.0.0";

        [STAThread]
        static int Main(string[] args)
        {
            bool uninstall = false, quiet = false, launch = true, processCheck = true;
            string render = null, logPath = null;
            for (int i = 0; i < args.Length; i++)
            {
                string a = args[i].ToLowerInvariant();
                if (a == "--uninstall") uninstall = true;
                else if (a == "--install") uninstall = false;
                else if (a == "--quiet") quiet = true;
                else if (a == "--no-launch") launch = false;
                else if (a == "--no-process-check") processCheck = false;
                else if (a == "--discord-root" && i + 1 < args.Length) Installer.DiscordRoot = args[++i];
                else if (a == "--install-dir" && i + 1 < args.Length) Installer.InstallDir = args[++i];
                else if (a == "--log" && i + 1 < args.Length) logPath = args[++i];
                else if (a == "--render" && i + 1 < args.Length) render = args[++i];
            }

            if (quiet)
            {
                var lines = new List<string>();
                int code = 0;
                try
                {
                    List<DiscordInstall> found = Installer.Find();
                    if (found.Count == 0) lines.Add("no Discord found");
                    List<string> wasRunning = processCheck ? Installer.StopDiscord() : new List<string>();
                    lines.AddRange(uninstall ? Installer.Uninstall(found) : Installer.Install(found));
                    if (launch)
                        foreach (DiscordInstall d in found.Where(d => wasRunning.Contains(d.Branch))) Installer.Launch(d);
                }
                catch (Exception e)
                {
                    lines.Add("error: " + e.Message);
                    code = 1;
                }
                if (logPath != null) File.WriteAllLines(logPath, lines.ToArray());
                return code;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            var form = new SetupForm();
            if (render != null)
            {
                // Controls only paint once the window exists, so show it off-screen first.
                form.StartPosition = FormStartPosition.Manual;
                form.Location = new Point(-5000, -5000);
                form.ShowInTaskbar = false;
                form.Show();
                Application.DoEvents();
                using (var whole = new Bitmap(form.Width, form.Height))
                {
                    form.DrawToBitmap(whole, new Rectangle(0, 0, form.Width, form.Height));
                    // keep only the client area; the title bar drawn this way looks nothing like Windows 11
                    Point client = form.PointToScreen(Point.Empty);
                    var area = new Rectangle(client.X - form.Left, client.Y - form.Top, form.ClientSize.Width, form.ClientSize.Height);
                    using (Bitmap inner = whole.Clone(area, whole.PixelFormat))
                        inner.Save(render, System.Drawing.Imaging.ImageFormat.Png);
                }
                return 0;
            }
            Application.Run(form);
            return 0;
        }
    }
}
