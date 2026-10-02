<#
  winprint-xps.ps1 - print one image on a Windows printer through the XPS
  print path: the same one Windows' own Ctrl+P photo printing uses. It
  starts from the printer's Printing Preferences (so a DNP entry's paper
  size and 2inch cut setting apply), picks the matching paper if needed,
  and prints the image edge to edge, turned to suit the sheet.

  HoloBooth calls it with -Image. Run it by hand to test a printer:
    powershell -STA -ExecutionPolicy Bypass -File .\electron\winprint-xps.ps1 -Printer "DS40 (Copy 1)"
  With no -Image it prints a colour test sheet with TOP on it.
  A wide sheet is turned and printed as a portrait 4x6 page; add -Turn left
  if it comes out upside down.
#>
param(
  [Parameter(Mandatory = $true)][string]$Printer,
  [string]$Image = '',
  [double]$W = 6,
  [double]$H = 4,
  [int]$Copies = 1,
  [ValidateSet('right', 'left')][string]$Turn = 'right'
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

  # Never send a landscape page: on the DS40 every landscape job (Chromium,
  # GDI, XPS) came out blank or not at all, while portrait pages (Windows'
  # test page, Ctrl+P) print. So a wide sheet is turned 90 degrees here and
  # sent as the driver's own portrait 4x6. -Turn picks the direction.
  if ($W -gt $H) {
    $bmp = New-Object System.Drawing.Bitmap($Image)
    $rot = if ($Turn -eq 'left') { [System.Drawing.RotateFlipType]::Rotate270FlipNone } else { [System.Drawing.RotateFlipType]::Rotate90FlipNone }
    $bmp.RotateFlip($rot)
    $turned = Join-Path $env:TEMP ('holobooth-portrait-' + [guid]::NewGuid().ToString('N') + '.jpg')
    $bmp.Save($turned, [System.Drawing.Imaging.ImageFormat]::Jpeg)
    $bmp.Dispose()
    $Image = $turned
    $t = $W; $W = $H; $H = $t
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
  # Use the paper chosen in Printing Preferences (DNP's own "(6x4)"), as
  # Ctrl+P does. Only switch if the preferences name a paper with a known,
  # different size AND the driver lists one that fits — DNP's driver reports
  # its sizes without dimensions, so usually there is nothing to compare.
  $cur = $ticket.PageMediaSize
  if ($cur -and $cur.Width -and -not (Fits $cur)) {
    $media = $caps.PageMediaSizeCapability | Where-Object { Fits $_ } | Select-Object -First 1
    if ($media) { $ticket.PageMediaSize = $media }
  }
  $ticket.PageOrientation = [System.Printing.PageOrientation]::Portrait
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
  $paper = if ($m -and $m.Width) { '{0}x{1}in' -f [math]::Round($m.Width / 96, 2), [math]::Round($m.Height / 96, 2) } else { "from Printing Preferences ($($m.PageMediaSizeName))" }
  Write-Output ('OK xps printer="{0}" paper={1} orientation={2} borderless={3}' -f $Printer, $paper, $ticket.PageOrientation, $ticket.PageBorderless)
} catch {
  Write-Output "ERR $($_.Exception.Message)"
  exit 1
}
