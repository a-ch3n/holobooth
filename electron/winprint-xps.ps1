<#
  winprint-xps.ps1 - print one image on a Windows printer through the XPS
  print path: the same one Windows' own Ctrl+P photo printing uses. It
  starts from the printer's Printing Preferences (so a DNP entry's paper
  size and 2inch cut setting apply), picks the matching paper if needed,
  and prints the image edge to edge, turned to suit the sheet.

  HoloBooth calls it with -Image. Run it by hand to test a printer:
    powershell -STA -ExecutionPolicy Bypass -File .\electron\winprint-xps.ps1 -Printer "DS40 (Copy 1)"
  With no -Image it prints a colour test sheet with TOP on it.
#>
param(
  [Parameter(Mandatory = $true)][string]$Printer,
  [string]$Image = '',
  [double]$W = 6,
  [double]$H = 4,
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
  # Keep the paper already chosen in Printing Preferences if it is the right
  # size (DNP's own "(6x4)"); otherwise use the driver's matching size.
  if (-not (Fits $ticket.PageMediaSize)) {
    $media = $caps.PageMediaSizeCapability | Where-Object { Fits $_ } | Select-Object -First 1
    if (-not $media) {
      $have = ($caps.PageMediaSizeCapability | Where-Object { $_.Width } | ForEach-Object { '{0}x{1}in' -f [math]::Round($_.Width / 96, 2), [math]::Round($_.Height / 96, 2) }) -join ', '
      throw "The printer has no $($W)x$($H)in paper. It has: $have"
    }
    $ticket.PageMediaSize = $media
  }
  $ticket.PageOrientation = if ($W -gt $H) { [System.Printing.PageOrientation]::Landscape } else { [System.Printing.PageOrientation]::Portrait }
  if ($caps.PageBorderlessCapability -contains [System.Printing.PageBorderless]::Borderless) {
    $ticket.PageBorderless = [System.Printing.PageBorderless]::Borderless
  }
  $ticket.CopyCount = [math]::Max(1, $Copies)
  $ticket = $queue.MergeAndValidatePrintTicket($base, $ticket).ValidatedPrintTicket

  # One fixed page the size of the sheet (wide for a 6x4 sheet), image filling it.
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
  Write-Output ('OK xps printer="{0}" paper={1}x{2}in orientation={3} borderless={4}' -f $Printer, [math]::Round($m.Width / 96, 2), [math]::Round($m.Height / 96, 2), $ticket.PageOrientation, $ticket.PageBorderless)
} catch {
  Write-Output "ERR $($_.Exception.Message)"
  exit 1
}
