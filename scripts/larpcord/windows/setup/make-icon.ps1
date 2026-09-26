<#
    Larpcord, a Discord client mod
    Copyright (c) 2026 Larpcord contributors
    SPDX-License-Identifier: GPL-3.0-or-later

    Draws the Larpcord d20 at every Windows icon size and writes a multi-size .ico.
    Same geometry and colors as scripts/larpcord/brand/d20.mjs.
      make-icon.ps1 -Out larpcord.ico
#>
param([Parameter(Mandatory = $true)][string]$Out)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$c30 = [math]::Cos([math]::PI / 6)
$P = @{
    top = @(12, 2); ur = @((12 + 10 * $c30), 7); lr = @((12 + 10 * $c30), 17)
    bottom = @(12, 22); ll = @((12 - 10 * $c30), 17); ul = @((12 - 10 * $c30), 7)
    t = @(12, 7.4); bl = @((12 - 4.6 * $c30), 14.3); br = @((12 + 4.6 * $c30), 14.3)
}
$facets = @(
    @(@("top", "ul", "t"), "#EBB35A"), @(@("top", "t", "ur"), "#CB8C32"),
    @(@("ul", "bl", "t"), "#DDA048"), @(@("ur", "t", "br"), "#B47420"),
    @(@("ul", "ll", "bl"), "#BB7C28"), @(@("ll", "bottom", "bl"), "#99621A"),
    @(@("bl", "bottom", "br"), "#C28530"), @(@("br", "bottom", "lr"), "#865414"),
    @(@("ur", "br", "lr"), "#774A11"), @(@("t", "bl", "br"), "#F6CD7C")
)
$edges = @(@("top", "t"), @("ul", "t"), @("ur", "t"), @("ul", "bl"), @("ll", "bl"), @("bottom", "bl"),
    @("ur", "br"), @("lr", "br"), @("bottom", "br"), @("t", "bl"), @("bl", "br"), @("br", "t"))

function Draw-D20([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)
    # the design spans y 2..22; fit that height with a hair of margin
    $scale = $size / 21.0
    $off = -1.5 * $scale
    $pt = { param($n) New-Object System.Drawing.PointF ([float]($P[$n][0] * $scale + ($size - 24 * $scale) / 2)), ([float]($P[$n][1] * $scale + $off)) }
    foreach ($f in $facets) {
        $pts = [System.Drawing.PointF[]]@($f[0] | ForEach-Object { & $pt $_ })
        $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($f[1]))
        $g.FillPolygon($brush, $pts)
        $brush.Dispose()
    }
    if ($size -ge 32) {
        $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(140, 42, 26, 7)), ([float]([math]::Max(1, 0.35 * $scale)))
        $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
        foreach ($e in $edges) { $g.DrawLine($pen, (& $pt $e[0]), (& $pt $e[1])) }
        $outline = [System.Drawing.PointF[]]@("top", "ur", "lr", "bottom", "ll", "ul" | ForEach-Object { & $pt $_ })
        $g.DrawPolygon($pen, $outline)
        $pen.Dispose()
    }
    $g.Dispose()
    $ms = New-Object System.IO.MemoryStream
    if ($size -ge 256) {
        # PNG is only safe for the 256 px entry; .NET and older Windows code read the rest as bitmaps
        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    } else {
        Write-Dib $bmp $ms
    }
    $bmp.Dispose()
    return , $ms.ToArray()
}

# Classic icon entry: BITMAPINFOHEADER, 32-bit BGRA rows bottom-up, then an all-clear AND mask.
function Write-Dib($bmp, $ms) {
    $s = $bmp.Width
    $w = New-Object System.IO.BinaryWriter $ms
    $maskRow = [int]([math]::Floor(($s + 31) / 32) * 4)
    $w.Write([uint32]40); $w.Write([int32]$s); $w.Write([int32]($s * 2))
    $w.Write([uint16]1); $w.Write([uint16]32); $w.Write([uint32]0)
    $w.Write([uint32]($s * $s * 4 + $maskRow * $s))
    $w.Write([int32]0); $w.Write([int32]0); $w.Write([uint32]0); $w.Write([uint32]0)
    $rect = New-Object System.Drawing.Rectangle 0, 0, $s, $s
    $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $row = New-Object byte[] ($s * 4)
    for ($y = $s - 1; $y -ge 0; $y--) {
        [System.Runtime.InteropServices.Marshal]::Copy([IntPtr]($data.Scan0.ToInt64() + $y * $data.Stride), $row, 0, $s * 4)
        $w.Write($row)
    }
    $bmp.UnlockBits($data)
    $w.Write((New-Object byte[] ($maskRow * $s)))
    $w.Flush()
}

$sizes = @(16, 20, 24, 32, 40, 48, 64, 128, 256)
$images = @($sizes | ForEach-Object { , (Draw-D20 $_) })
$stream = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter $stream
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $s = $sizes[$i]
    $dim = if ($s -ge 256) { 0 } else { $s }
    $w.Write([byte]$dim); $w.Write([byte]$dim); $w.Write([byte]0); $w.Write([byte]0)
    $w.Write([uint16]1); $w.Write([uint16]32)
    $w.Write([uint32]$images[$i].Length); $w.Write([uint32]$offset)
    $offset += $images[$i].Length
}
foreach ($img in $images) { $w.Write($img) }
$w.Flush()
[IO.File]::WriteAllBytes($Out, $stream.ToArray())
Write-Host "wrote $Out ($($sizes -join ', ') px)"
