# Generates all 12 evidence cards in the shared visual language of the landing page.
# The canonical case materials in cases.mjs remain the single source of truth.
# Run with Windows PowerShell and System.Drawing.

Add-Type -AssemblyName System.Drawing

$botDir = if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { (Get-Location).Path }
$casesPath = Join-Path $botDir "cases.mjs"
$outDir = Join-Path (Split-Path -Parent $botDir) "public\evidence"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$source = Get-Content -Raw -Encoding UTF8 $casesPath
$pattern = 'id:\s*(\d+),\s*date:\s*\{[^}]*\},\s*title:\s*"([^"]+)",.*?materials:\s*\[(.*?)\]\.join\("\\n"\)'
$matches = [regex]::Matches($source, $pattern, [System.Text.RegularExpressions.RegexOptions]::Singleline)
if ($matches.Count -ne 12) { throw "Expected 12 cases in cases.mjs, found $($matches.Count)." }

function New-Color([string]$hex) { return [System.Drawing.ColorTranslator]::FromHtml($hex) }
function New-Font([string]$name, [float]$size, [System.Drawing.FontStyle]$style) { return New-Object System.Drawing.Font($name, $size, $style) }

$backgroundColor = New-Color "#07090E"
$panelColor = New-Color "#0D1118"
$panelAltColor = New-Color "#0D1118"
$borderColor = New-Color "#2B3B45"
$textColor = New-Color "#F4F2EC"
$mutedColor = New-Color "#A9B3BD"
$cyanColor = New-Color "#6BF3DC"
$pinkColor = New-Color "#FF6578"
$goldColor = New-Color "#FFBD68"
$negativeColor = New-Color "#FF6578"

$headerFont = New-Font "Consolas" 22 ([System.Drawing.FontStyle]::Regular)
$caseFont = New-Font "Consolas" 28 ([System.Drawing.FontStyle]::Bold)
$titleFont = New-Font "Arial" 50 ([System.Drawing.FontStyle]::Bold)
$subtitleFont = New-Font "Consolas" 22 ([System.Drawing.FontStyle]::Regular)
$labelFont = New-Font "Consolas" 22 ([System.Drawing.FontStyle]::Bold)
$bodyFont = New-Font "Consolas" 25 ([System.Drawing.FontStyle]::Regular)
$smallFont = New-Font "Consolas" 18 ([System.Drawing.FontStyle]::Regular)

function Get-WrappedLines {
  param([string]$Text, [System.Drawing.Graphics]$Graphics, [System.Drawing.Font]$Font, [float]$MaxWidth)
  if ([string]::IsNullOrWhiteSpace($Text)) { return @() }
  $words = $Text -split '\s+'
  $lines = New-Object System.Collections.Generic.List[string]
  $current = ""
  foreach ($word in $words) {
    $candidate = if ($current -eq "") { $word } else { "$current $word" }
    if ($Graphics.MeasureString($candidate, $Font).Width -le $MaxWidth) {
      $current = $candidate
    } else {
      if ($current -ne "") { $lines.Add($current) }
      $current = $word
    }
  }
  if ($current -ne "") { $lines.Add($current) }
  return $lines
}

function Draw-RoundedPanel {
  param([System.Drawing.Graphics]$Graphics, [System.Drawing.RectangleF]$Rect, [System.Drawing.Color]$Fill, [System.Drawing.Color]$Border, [float]$Radius = 18)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $Radius * 2
  $path.AddArc($Rect.X, $Rect.Y, $d, $d, 180, 90)
  $path.AddArc($Rect.Right - $d, $Rect.Y, $d, $d, 270, 90)
  $path.AddArc($Rect.Right - $d, $Rect.Bottom - $d, $d, $d, 0, 90)
  $path.AddArc($Rect.X, $Rect.Bottom - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  $fillBrush = New-Object System.Drawing.SolidBrush($Fill)
  $borderPen = New-Object System.Drawing.Pen($Border, 1.4)
  $Graphics.FillPath($fillBrush, $path)
  $Graphics.DrawPath($borderPen, $path)
  $fillBrush.Dispose(); $borderPen.Dispose(); $path.Dispose()
}

foreach ($match in $matches) {
  $caseId = [int]$match.Groups[1].Value
  $title = $match.Groups[2].Value
  $materialBlock = $match.Groups[3].Value
  $materialLines = [regex]::Matches($materialBlock, '"([^"]*)"') | ForEach-Object { $_.Groups[1].Value }

  $bitmap = New-Object System.Drawing.Bitmap(1080, 1350)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
  $graphics.Clear($backgroundColor)

  $textBrush = New-Object System.Drawing.SolidBrush($textColor)
  $mutedBrush = New-Object System.Drawing.SolidBrush($mutedColor)
  $cyanBrush = New-Object System.Drawing.SolidBrush($cyanColor)
  $pinkBrush = New-Object System.Drawing.SolidBrush($pinkColor)
  $goldBrush = New-Object System.Drawing.SolidBrush($goldColor)
  $accentPen = New-Object System.Drawing.Pen($cyanColor, 1.5)
  $separatorPen = New-Object System.Drawing.Pen($borderColor, 1)

  # Outer archive frame and header, matching the first three cards.
  $outerPath = New-Object System.Drawing.Drawing2D.GraphicsPath
  $outerPath.AddArc(2, 2, 58, 58, 180, 90); $outerPath.AddArc(1020, 2, 58, 58, 270, 90)
  $outerPath.AddArc(1020, 1290, 58, 58, 0, 90); $outerPath.AddArc(2, 1290, 58, 58, 90, 90); $outerPath.CloseFigure()
  $graphics.DrawPath($accentPen, $outerPath)
  $outerPath.Dispose()

  $number = $caseId.ToString("00")
  $graphics.DrawString("VERDE BAY · CASE FILE / 19 DEC", $headerFont, $cyanBrush, 58, 54)
  $graphics.DrawString($number, $caseFont, $pinkBrush, 975, 52)
  $graphics.DrawLine($separatorPen, 58, 116, 1022, 116)
  $graphics.DrawString($title.ToUpperInvariant(), $titleFont, $textBrush, 58, 146)
  $graphics.DrawString("ПРИЛОЖЕНИЕ A · АРХИВ УЛИК", $subtitleFont, $mutedBrush, 58, 238)
  $graphics.DrawLine($separatorPen, 58, 286, 1022, 286)

  $sections = New-Object System.Collections.Generic.List[object]
  $current = $null
  foreach ($line in $materialLines) {
    if ($line -match '^УЛИКА\s+([A-ZА-Я])\s*·\s*(.*)$') {
      if ($null -ne $current) { $sections.Add($current) }
      $current = [ordered]@{ Letter = $matches[1]; Heading = $matches[2]; Lines = New-Object System.Collections.Generic.List[string] }
    } elseif ($null -ne $current -and -not [string]::IsNullOrWhiteSpace($line)) {
      $current.Lines.Add($line)
    }
  }
  if ($null -ne $current) { $sections.Add($current) }

  $y = 322.0
  foreach ($section in $sections) {
    $wrapped = New-Object System.Collections.Generic.List[string]
    foreach ($line in $section.Lines) {
      foreach ($part in (Get-WrappedLines -Text $line -Graphics $graphics -Font $bodyFont -MaxWidth 850)) { $wrapped.Add($part) }
    }
    $height = 76 + ($wrapped.Count * 31) + 24
    if ($y + $height -gt 1240) { $height = 1240 - $y }
    $fill = if (($sections.IndexOf($section) % 2) -eq 0) { $panelColor } else { $panelAltColor }
    Draw-RoundedPanel -Graphics $graphics -Rect (New-Object System.Drawing.RectangleF(58, $y, 964, $height)) -Fill $fill -Border $borderColor -Radius 20
    $graphics.DrawString("УЛИКА $($section.Letter) · $($section.Heading)", $labelFont, $goldBrush, 92, ($y + 28))
    $bodyY = $y + 78
    foreach ($line in $wrapped) {
      if ($bodyY -gt ($y + $height - 25)) { break }
      $graphics.DrawString($line, $bodyFont, $textBrush, 92, $bodyY)
      $bodyY += 31
    }
    $y += $height + 18
  }

  $graphics.DrawLine($separatorPen, 58, 1280, 1022, 1280)
  $graphics.DrawString("АРХИВ · VERDE BAY / EVIDENCE LOG", $smallFont, $mutedBrush, 58, 1300)
  $graphics.DrawString("ВРЕМЯ МЕСТНОЕ", $smallFont, $mutedBrush, 840, 1300)

  $graphics.Dispose()
  $fileName = "case-$number-evidence.png"
  $path = Join-Path $outDir $fileName
  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bitmap.Dispose()
  Write-Output "Created $fileName"
}

$headerFont.Dispose(); $caseFont.Dispose(); $titleFont.Dispose(); $subtitleFont.Dispose()
$labelFont.Dispose(); $bodyFont.Dispose(); $smallFont.Dispose()
