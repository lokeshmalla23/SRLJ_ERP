const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');

const execFileAsync = promisify(execFile);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function escapePs(s) {
  return String(s || '').replace(/'/g, "''");
}

/**
 * Print a PNG/JPG via System.Drawing (GDI) — same stack Windows uses for photos.
 * This works with Canon CAPT drivers when Chromium silent print does not.
 */
async function printImageGdi(filePath, printerName, { timeoutMs = 20_000, paperSizeName = null, pageWidthIn = null, pageHeightIn = null } = {}) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error('Print image missing');
  }
  const safeFile = escapePs(path.resolve(filePath));
  const safePrinter = escapePs(printerName);
  const safePaperSize = escapePs(paperSizeName);
  const wIn = Number(pageWidthIn) > 0 ? Number(pageWidthIn) : 0;
  const hIn = Number(pageHeightIn) > 0 ? Number(pageHeightIn) : 0;
  const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$file = '${safeFile}'
$printer = '${safePrinter}'
$paperSizeName = '${safePaperSize}'
$pageWIn = ${wIn}
$pageHIn = ${hIn}
if (-not (Test-Path -LiteralPath $file)) { throw "Image not found: $file" }
$img = [System.Drawing.Image]::FromFile($file)
try {
  $pd = New-Object System.Drawing.Printing.PrintDocument
  $pd.DocumentName = 'SSJ ERP Invoice'
  if ($printer) {
    $pd.PrinterSettings.PrinterName = $printer
    if (-not $pd.PrinterSettings.IsValid) { throw "Printer not valid: $printer" }
  }
  $matchedPaper = $null
  if ($paperSizeName) {
    $matchedPaper = $pd.PrinterSettings.PaperSizes | Where-Object { $_.PaperName -ieq $paperSizeName } | Select-Object -First 1
    if (-not $matchedPaper) {
      $matchedPaper = $pd.PrinterSettings.PaperSizes | Where-Object { $_.PaperName -ilike "*$paperSizeName*" } | Select-Object -First 1
    }
  }
  if ($matchedPaper) {
    $pd.DefaultPageSettings.PaperSize = $matchedPaper
  } elseif ($pageWIn -gt 0 -and $pageHIn -gt 0) {
    # No named size on this driver matches (or none was requested) — build a
    # custom size matching the actual requested page dimensions instead of
    # leaving the driver's unrelated default page length in place. Without
    # this, content taller than that stale default gets uniformly shrunk
    # (width included) to fit inside it — the "more items = whole receipt
    # shrinks" bug, since driver paper-size lists rarely have a named entry
    # matching "THERMAL" (or any) per-content custom length.
    $customW = [int]([Math]::Round($pageWIn * 100))
    $customH = [int]([Math]::Round($pageHIn * 100))
    $pd.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize('Custom', $customW, $customH)
  }
  $pd.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
  $pd.PrintController = New-Object System.Drawing.Printing.StandardPrintController
  $script:err = $null
  $pd.add_PrintPage({
    param($sender, $e)
    try {
      if ($pageWIn -gt 0 -and $pageHIn -gt 0) {
        $w = [double]([Math]::Round($pageWIn * 100))
        $h = [double]([Math]::Round($pageHIn * 100))
        # Graphics (0,0) is the top-left of the PRINTABLE area, not the paper edge —
        # it is already inset by the printer's hardware margin. Drawing the full
        # nominal page size from there overshoots the printable area on the far
        # side (commonly right/bottom), which the printer silently clips. Shrink
        # to fit the real printable area instead of overflowing it.
        $printable = $e.PageSettings.PrintableArea
        if ($printable -and $printable.Width -gt 0 -and $printable.Height -gt 0) {
          $scale = [Math]::Min($printable.Width / $w, $printable.Height / $h)
          if ($scale -lt 1) {
            $w = $w * $scale
            $h = $h * $scale
          }
        }
        $e.Graphics.DrawImage($img, 0, 0, [single]$w, [single]$h)
      } else {
        $page = $e.PageBounds
        $e.Graphics.DrawImage($img, $page.X, $page.Y, $page.Width, $page.Height)
      }
      $e.HasMorePages = $false
    } catch {
      $script:err = $_.Exception.Message
      $e.Cancel = $true
    }
  })
  $pd.Print()
  if ($script:err) { throw $script:err }
} finally {
  $img.Dispose()
}
`;
  await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps],
    { windowsHide: true, timeout: timeoutMs, encoding: 'utf8' },
  );
}

/**
 * Print one or more images in a single PowerShell/GDI session (one process
 * start). highQuality uses bicubic interpolation so a sharp bitmap stays
 * sharp on the physical page instead of looking soft.
 */
async function printImageFilesGdi(filePaths, printerName, {
  timeoutMs = 40_000,
  paperSizeName = null,
  pageWidthIn = null,
  pageHeightIn = null,
  highQuality = false,
  fillPaper = false,
  paperKind = 0,
} = {}) {
  const files = (Array.isArray(filePaths) ? filePaths : [filePaths])
    .map((p) => path.resolve(String(p || '')))
    .filter((p) => p && fs.existsSync(p));
  if (!files.length) throw new Error('Print image missing');
  if (files.length === 1 && !highQuality && !fillPaper) {
    return printImageGdi(files[0], printerName, { timeoutMs, paperSizeName, pageWidthIn, pageHeightIn });
  }

  const safePrinter = escapePs(printerName);
  const safePaperSize = escapePs(paperSizeName);
  const wIn = Number(pageWidthIn) > 0 ? Number(pageWidthIn) : 0;
  const hIn = Number(pageHeightIn) > 0 ? Number(pageHeightIn) : 0;
  const fileList = files.map((f) => `'${escapePs(f)}'`).join(',');
  const hq = highQuality ? '1' : '0';
  const fill = fillPaper ? '1' : '0';
  const kind = Number(paperKind) > 0 ? Number(paperKind) : 0;
  const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$files = @(${fileList})
$printer = '${safePrinter}'
$paperSizeName = '${safePaperSize}'
$pageWIn = ${wIn}
$pageHIn = ${hIn}
$highQuality = ${hq}
$fillPaper = ${fill}
$paperKind = ${kind}
$images = New-Object System.Collections.Generic.List[System.Drawing.Image]
try {
  foreach ($file in $files) {
    if (-not (Test-Path -LiteralPath $file)) { throw "Image not found: $file" }
    $images.Add([System.Drawing.Image]::FromFile($file))
  }
  $pd = New-Object System.Drawing.Printing.PrintDocument
  $pd.DocumentName = 'SSJ ERP Invoice'
  if ($printer) {
    $pd.PrinterSettings.PrinterName = $printer
    if (-not $pd.PrinterSettings.IsValid) { throw "Printer not valid: $printer" }
  }
  $matchedPaper = $null
  if ($paperKind -gt 0) {
    $matchedPaper = $pd.PrinterSettings.PaperSizes | Where-Object { $_.RawKind -eq $paperKind } | Select-Object -First 1
  }
  if (-not $matchedPaper -and $paperSizeName) {
    $matchedPaper = $pd.PrinterSettings.PaperSizes | Where-Object { $_.PaperName -ieq $paperSizeName } | Select-Object -First 1
    if (-not $matchedPaper) {
      $matchedPaper = $pd.PrinterSettings.PaperSizes | Where-Object { $_.PaperName -ilike "*$paperSizeName*" } | Select-Object -First 1
    }
  }
  if ($matchedPaper) {
    $pd.DefaultPageSettings.PaperSize = $matchedPaper
    try { $pd.PrinterSettings.DefaultPageSettings.PaperSize = $matchedPaper } catch {}
  } elseif ($pageWIn -gt 0 -and $pageHIn -gt 0) {
    $customW = [int]([Math]::Round($pageWIn * 100))
    $customH = [int]([Math]::Round($pageHIn * 100))
    $custom = New-Object System.Drawing.Printing.PaperSize('Custom', $customW, $customH)
    if ($paperKind -gt 0) { try { $custom.RawKind = $paperKind } catch {} }
    $pd.DefaultPageSettings.PaperSize = $custom
  }
  $pd.DefaultPageSettings.Landscape = $false
  $pd.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
  $pd.PrintController = New-Object System.Drawing.Printing.StandardPrintController
  $script:err = $null
  $script:idx = 0
  $pd.add_PrintPage({
    param($sender, $e)
    try {
      $img = $images[$script:idx]
      if ($highQuality -eq 1) {
        $e.Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $e.Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $e.Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::None
        $e.Graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
      }
      $printable = $e.PageSettings.PrintableArea
      if ($fillPaper -eq 1 -and $printable -and $printable.Width -gt 0 -and $printable.Height -gt 0) {
        $e.Graphics.DrawImage($img, 0, 0, [single]$printable.Width, [single]$printable.Height)
      } elseif ($pageWIn -gt 0 -and $pageHIn -gt 0) {
        $w = [double]([Math]::Round($pageWIn * 100))
        $h = [double]([Math]::Round($pageHIn * 100))
        if ($printable -and $printable.Width -gt 0 -and $printable.Height -gt 0) {
          $scale = [Math]::Min($printable.Width / $w, $printable.Height / $h)
          if ($scale -lt 1) {
            $w = $w * $scale
            $h = $h * $scale
          }
        }
        $e.Graphics.DrawImage($img, 0, 0, [single]$w, [single]$h)
      } else {
        $page = $e.PageBounds
        $e.Graphics.DrawImage($img, $page.X, $page.Y, $page.Width, $page.Height)
      }
      $script:idx++
      $e.HasMorePages = $script:idx -lt $images.Count
    } catch {
      $script:err = $_.Exception.Message
      $e.Cancel = $true
    }
  })
  $pd.Print()
  if ($script:err) { throw $script:err }
} finally {
  foreach ($img in $images) { $img.Dispose() }
}
`;
  await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps],
    { windowsHide: true, timeout: timeoutMs, encoding: 'utf8' },
  );
}

/**
 * Send a file to a Windows printer. Images use GDI; PDFs use Shell PrintTo.
 */
async function printFileToWindowsPrinter(filePath, printerName, {
  timeoutMs = 20_000,
  paperSizeName = null,
  pageWidthIn = null,
  pageHeightIn = null,
} = {}) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error('Print file missing');
  }
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.bmp') {
    return printImageGdi(filePath, printerName, { timeoutMs, paperSizeName, pageWidthIn, pageHeightIn });
  }

  const safeFile = escapePs(path.resolve(filePath));
  const safePrinter = escapePs(printerName);
  const ps = `
$ErrorActionPreference = 'Stop'
$file = '${safeFile}'
$printer = '${safePrinter}'
if (-not (Test-Path -LiteralPath $file)) { throw "Print file not found: $file" }
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $file
$psi.UseShellExecute = $true
$psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
if ($printer) {
  $psi.Verb = 'PrintTo'
  $psi.Arguments = '"' + $printer + '"'
} else {
  $psi.Verb = 'Print'
}
$p = [System.Diagnostics.Process]::Start($psi)
if (-not $p) { throw 'Windows failed to start the print verb' }
Start-Sleep -Milliseconds 1200
`;
  await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps],
    { windowsHide: true, timeout: timeoutMs, encoding: 'utf8' },
  );
}

/**
 * Optional: SumatraPDF silent print when installed (reliable PDF to CAPT).
 * Returns true if Sumatra handled it, false if not available.
 */
async function trySumatraPrint(filePath, printerName) {
  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'SumatraPDF', 'SumatraPDF.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'SumatraPDF', 'SumatraPDF.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'SumatraPDF', 'SumatraPDF.exe'),
  ];
  const exe = candidates.find((p) => p && fs.existsSync(p));
  if (!exe) return false;

  await new Promise((resolve, reject) => {
    const child = spawn(
      exe,
      ['-print-to', printerName, '-silent', '-exit-when-done', filePath],
      { windowsHide: true, stdio: 'ignore' },
    );
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* */ }
      reject(new Error('SumatraPDF print timed out'));
    }, 25_000);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0 || code == null) resolve();
      else reject(new Error(`SumatraPDF exited with code ${code}`));
    });
  });
  return true;
}

module.exports = {
  sleep,
  printImageGdi,
  printImageFilesGdi,
  printFileToWindowsPrinter,
  trySumatraPrint,
};
