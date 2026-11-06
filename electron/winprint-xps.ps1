<#
  winprint-xps.ps1 - print one image on a Windows printer through the XPS
  print path: the same one Windows' own Ctrl+P photo printing uses. It
  starts from the printer's Printing Preferences (so a DNP entry's paper
  size and 2inch cut setting apply), picks the matching paper if needed,
  and prints the image edge to edge on the 4x6 paper, as a portrait job.

  HoloBooth calls it with -Image. Run it by hand to test a printer:
    powershell -STA -ExecutionPolicy Bypass -File .\electron\winprint-xps.ps1 -Printer "DS40 (Copy 1)"
  With no -Image it prints a colour test sheet with TOP on it.
  -W / -H are the queue's own paper as the driver defines it (HoloBooth
  reads it from Printing Preferences), and the image must already have that
  shape: the native 6x4 sheet if the paper is defined wide, the portrait
  frame (toDriverFrame) if it's defined tall. The job is always Portrait,
  whatever the queue says: the DS40 driver turned landscape jobs into the
  wrong shape. This script never rotates anything.
#>
param(
  [Parameter(Mandatory = $true)][string]$Printer,
  [string]$Image = '',
  [double]$W = 4,
  [double]$H = 6,
  [int]$Copies = 1
)
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName PresentationCore, PresentationFramework, ReachFramework, System.Printing, System.Drawing

  if (-not $Image) {
    # Standalone test: a sheet that can't be mistaken for blank or upside down.
    $px = [int]($W * 300); $py = [int]($H * 300)
    $bmp = New-Object System.Drawing.Bitmap($px, $py)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $cols = '#E53935', '#FB8C00', '#FDD835', '#43A047', '#1E88E5', '#8E24AA'
    for ($i = 0; $i -lt 6; $i++) {
      $brush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml($cols[$i]))
      $g.FillRectangle($brush, 0, [int]($i * $py / 6), $px, [int]($py / 6) + 1)
    }
    $font = New-Object System.Drawing.Font('Arial', [single]($py / 9), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $g.DrawString('TOP', $font, [System.Drawing.Brushes]::White, (New-Object System.Drawing.RectangleF(0, 0, $px, [single]($py / 3))), $sf)
    $g.DrawString('HOLOBOOTH TEST', $font, [System.Drawing.Brushes]::White, (New-Object System.Drawing.RectangleF(0, [single]($py / 3), $px, [single]($py / 3))), $sf)
    $g.Dispose()
    $Image = Join-Path $env:TEMP 'holobooth-xps-test.jpg'
    $bmp.Save($Image, [System.Drawing.Imaging.ImageFormat]::Jpeg)
    $bmp.Dispose()
  }

  # The image must already have the paper's shape: anything else is refused, never turned.
  $probe = [System.Drawing.Image]::FromFile($Image)
  $imgWide = $probe.Width -gt $probe.Height
  $probe.Dispose()
  if ($imgWide -ne ($W -gt $H)) { Write-Output ('ERR The page ({0}) does not have the paper''s shape ({1} x {2} in); nothing is turned here' -f ($(if ($imgWide) { 'wide' } else { 'tall' })), $W, $H); exit 4 }

  $server = New-Object System.Printing.LocalPrintServer
  $queue = $server.GetPrintQueue($Printer)
  $caps = $queue.GetPrintCapabilities()
  # The user's Printing Preferences (paper, cut, etc.), else the printer's defaults.
  $base = if ($queue.UserPrintTicket) { $queue.UserPrintTicket } else { $queue.DefaultPrintTicket }
  $ticket = $base.Clone()

  # Sizes here are in 1/96 inch.
  $ww = $W * 96; $hh = $H * 96
  function Fits($m) {
    $m -and $m.Width -and $m.Height -and (
      ([math]::Abs($m.Width - $ww) -lt 12 -and [math]::Abs($m.Height - $hh) -lt 12) -or
      ([math]::Abs($m.Width - $hh) -lt 12 -and [math]::Abs($m.Height - $ww) -lt 12))
  }
  # Use the paper chosen in Printing Preferences (DNP's own "(6x4)"), as
  # Ctrl+P does. Only switch if the preferences name a paper with a known,
  # different size AND the driver lists one that fits — DNP's driver reports
  # its sizes without dimensions, so usually there is nothing to compare.
  $cur = $ticket.PageMediaSize
  if ($cur -and $cur.Width -and -not (Fits $cur)) {
    $media = $caps.PageMediaSizeCapability | Where-Object { Fits $_ } | Select-Object -First 1
    if ($media) { $ticket.PageMediaSize = $media }
  }
  if ($caps.PageBorderlessCapability -contains [System.Printing.PageBorderless]::Borderless) {
    $ticket.PageBorderless = [System.Printing.PageBorderless]::Borderless
  }
  # A portrait job on the portrait paper: the driver turns nothing.
  $ticket.PageOrientation = [System.Printing.PageOrientation]::Portrait
  $ticket.CopyCount = [math]::Max(1, $Copies)
  $ticket = $queue.MergeAndValidatePrintTicket($base, $ticket).ValidatedPrintTicket

  # One fixed page the size of the paper, image filling it.
  $size = New-Object System.Windows.Size($ww, $hh)
  $src = New-Object System.Windows.Media.Imaging.BitmapImage
  $src.BeginInit()
  $src.CacheOption = [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad
  $src.UriSource = New-Object System.Uri($Image)
  $src.EndInit()
  $img = New-Object System.Windows.Controls.Image
  $img.Source = $src
  $img.Stretch = [System.Windows.Media.Stretch]::Fill
  $img.Width = $ww; $img.Height = $hh
  $page = New-Object System.Windows.Documents.FixedPage
  $page.Width = $ww; $page.Height = $hh
  [void]$page.Children.Add($img)
  $page.Measure($size)
  $page.Arrange((New-Object System.Windows.Rect($size)))
  $page.UpdateLayout()
  $content = New-Object System.Windows.Documents.PageContent
  ([System.Windows.Markup.IAddChild]$content).AddChild($page)
  $doc = New-Object System.Windows.Documents.FixedDocument
  $doc.DocumentPaginator.PageSize = $size
  [void]$doc.Pages.Add($content)

  $writer = [System.Printing.PrintQueue]::CreateXpsDocumentWriter($queue)
  $writer.Write($doc, $ticket)

  $m = $ticket.PageMediaSize
  $paper = if ($m -and $m.Width) { '{0}x{1}in' -f [math]::Round($m.Width / 96, 2), [math]::Round($m.Height / 96, 2) } else { "from Printing Preferences ($($m.PageMediaSizeName))" }
  Write-Output ('OK xps printer="{0}" paper={1} orientation={2} borderless={3}' -f $Printer, $paper, $ticket.PageOrientation, $ticket.PageBorderless)
} catch {
  Write-Output "ERR $($_.Exception.Message)"
  exit 1
}
