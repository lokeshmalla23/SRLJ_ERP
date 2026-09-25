import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { logger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);

function escapePs(s) {
  return String(s || '').replace(/'/g, "''");
}

/** \\SERVER\Share Name → Share Name */
export function localPrinterNameFromUnc(name) {
  const raw = String(name || '').trim();
  if (!raw) return null;
  if (raw.startsWith('\\\\')) {
    const parts = raw.replace(/^\\\\/, '').split('\\').filter(Boolean);
    return parts.length >= 2 ? parts.slice(1).join('\\') : raw;
  }
  return raw;
}

export function isUncPrinterName(name) {
  return String(name || '').trim().startsWith('\\\\');
}

/**
 * List installed Windows printers (name + default flag).
 */
export async function listWindowsPrinters() {
  const ps = `
$ErrorActionPreference = 'SilentlyContinue'
Get-CimInstance Win32_Printer | ForEach-Object {
  [pscustomobject]@{
    Name = [string]$_.Name
    Default = [bool]$_.Default
    WorkOffline = [bool]$_.WorkOffline
    PrinterStatus = [int]$_.PrinterStatus
  }
} | ConvertTo-Json -Compress
`;
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps],
      { windowsHide: true, timeout: 8_000, encoding: 'utf8' },
    );
    const raw = JSON.parse(String(stdout || '').trim() || '[]');
    return Array.isArray(raw) ? raw : (raw ? [raw] : []);
  } catch (err) {
    logger.warn('print', 'listWindowsPrinters failed', { error: err.message });
    return [];
  }
}

/**
 * Resolve a usable local printer on the host for an invoice job.
 */
export async function resolveHostInvoicePrinter(preferredName) {
  const printers = await listWindowsPrinters();
  const physical = printers.filter((p) => {
    const n = String(p.Name || '');
    return n && !/print to pdf|microsoft print to pdf|xps document writer|onenote|fax/i.test(n);
  });
  if (!physical.length) return null;

  const preferLocal = localPrinterNameFromUnc(preferredName);
  if (preferLocal) {
    const exact = physical.find((p) => p.Name === preferLocal || p.Name === preferredName);
    if (exact && !exact.WorkOffline) return exact.Name;
    const loose = physical.find((p) =>
      String(p.Name).toLowerCase().includes(String(preferLocal).toLowerCase())
      || String(preferLocal).toLowerCase().includes(String(p.Name).toLowerCase()),
    );
    if (loose && !loose.WorkOffline) return loose.Name;
  }

  const def = physical.find((p) => p.Default && !p.WorkOffline);
  if (def) return def.Name;
  const ready = physical.find((p) => !p.WorkOffline);
  return (ready || physical[0]).Name;
}

/**
 * Print a raster image via System.Drawing GDI (works with Canon CAPT on the host USB).
 */
export async function printImageGdi(filePath, printerName, {
  timeoutMs = 25_000,
  paperSizeName = null,
  pageWidthIn = null,
  pageHeightIn = null,
  fillPaper = false,
  paperKind = 0,
} = {}) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw Object.assign(new Error('Print image missing'), { code: 'PRINT_FILE_MISSING' });
  }
  const safeFile = escapePs(path.resolve(filePath));
  const safePrinter = escapePs(printerName);
  const safePaperSize = escapePs(paperSizeName);
  const wIn = Number(pageWidthIn) > 0 ? Number(pageWidthIn) : 0;
  const hIn = Number(pageHeightIn) > 0 ? Number(pageHeightIn) : 0;
  const fill = fillPaper ? '1' : '0';
  const kind = Number(paperKind) > 0 ? Number(paperKind) : 0;
  const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$file = '${safeFile}'
$printer = '${safePrinter}'
$paperSizeName = '${safePaperSize}'
$pageWIn = ${wIn}
$pageHIn = ${hIn}
$fillPaper = ${fill}
$paperKind = ${kind}
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
    # No named size on this driver matches (or none was requested) — build a
    # custom size matching the actual requested page dimensions instead of
    # leaving the driver's unrelated default page size in place (keep this in
    # sync with desktop/lib/windowsPrint.js's printImageGdi, which this host
    # client-relay path duplicates).
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
  $pd.add_PrintPage({
    param($sender, $e)
    try {
      $printable = $e.PageSettings.PrintableArea
      if ($fillPaper -eq 1 -and $printable -and $printable.Width -gt 0 -and $printable.Height -gt 0) {
        $e.Graphics.DrawImage($img, 0, 0, [single]$printable.Width, [single]$printable.Height)
      } elseif ($pageWIn -gt 0 -and $pageHIn -gt 0) {
        $w = [double]([Math]::Round($pageWIn * 100))
        $h = [double]([Math]::Round($pageHIn * 100))
        # Graphics (0,0) is the top-left of the PRINTABLE area, not the paper
        # edge — already inset by the printer's hardware margin. Drawing the
        # full nominal page size from there overshoots the printable area on
        # the far side (commonly right/bottom), which the printer silently
        # clips — this was missing here (present on the host-local path in
        # desktop/lib/windowsPrint.js) and is why client-relayed prints lost
        # their right-hand columns while host-local prints did not.
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
 * Send raw bytes (TSPL bitmap / ESC-POS) straight to a Windows printer via the
 * spooler's RAW datatype — same mechanism as desktop/lib/rawPrinter.js's
 * sendRawToWindowsPrinter, ported here so the host can perform it for a
 * client PC's relayed label/estimation job (raw RAW-datatype writes only
 * work when the printer is physically local to the machine making the
 * call — a client relaying to a network-shared printer needed this to run
 * on the host instead).
 */
export async function sendRawBytesOnWindowsPrinter(printerName, bytes) {
  const name = String(printerName || '').trim();
  if (!name) throw Object.assign(new Error('Printer name required'), { status: 400 });
  if (!bytes || !bytes.length) throw Object.assign(new Error('Empty print data'), { status: 400 });

  const safeName = escapePs(name);
  const tmpBin = path.join(os.tmpdir(), `ssj-host-raw-${Date.now()}.bin`);
  fs.writeFileSync(tmpBin, bytes);
  const safePath = escapePs(tmpBin);

  const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class RawPrinterHelper {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }
  [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
  [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);

  public static bool SendBytes(string printerName, byte[] bytes) {
    IntPtr hPrinter;
    if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) return false;
    var di = new DOCINFOA();
    di.pDocName = "JewelleryCRM Relay";
    di.pDataType = "RAW";
    if (!StartDocPrinter(hPrinter, 1, di)) { ClosePrinter(hPrinter); return false; }
    if (!StartPagePrinter(hPrinter)) { EndDocPrinter(hPrinter); ClosePrinter(hPrinter); return false; }
    IntPtr pBytes = Marshal.AllocCoTaskMem(bytes.Length);
    Marshal.Copy(bytes, 0, pBytes, bytes.Length);
    int written = 0;
    bool ok = WritePrinter(hPrinter, pBytes, bytes.Length, out written);
    Marshal.FreeCoTaskMem(pBytes);
    EndPagePrinter(hPrinter);
    EndDocPrinter(hPrinter);
    ClosePrinter(hPrinter);
    return ok && written == bytes.Length;
  }
}
"@
$bytes = [System.IO.File]::ReadAllBytes('${safePath}')
$ok = [RawPrinterHelper]::SendBytes('${safeName}', $bytes)
if (-not $ok) { throw "Raw print to '${safeName}' failed — printer offline or driver not installed" }
`;

  try {
    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps],
      { windowsHide: true, timeout: 30_000 },
    );
  } finally {
    try { fs.unlinkSync(tmpBin); } catch { /* */ }
  }
}

/**
 * Accept base64 raw printer bytes (TSPL bitmap / ESC-POS) from a client PC and
 * write them straight to the host's local printer — the raw-byte counterpart
 * to printBase64ImageOnHost, for label/estimation printers relayed the same
 * way invoices already are.
 */
export async function printRawBytesOnHost({ bytesBase64, preferredPrinter } = {}) {
  const raw = String(bytesBase64 || '');
  if (!raw || raw.length < 10) {
    throw Object.assign(new Error('Invalid print payload'), { status: 400 });
  }
  let buffer;
  try {
    buffer = Buffer.from(raw, 'base64');
  } catch {
    throw Object.assign(new Error('Invalid base64 payload'), { status: 400 });
  }
  if (!buffer.length || buffer.length > 12_000_000) {
    throw Object.assign(new Error('Print payload size out of range'), { status: 400 });
  }

  const printer = await resolveHostInvoicePrinter(preferredPrinter);
  if (!printer) {
    throw Object.assign(
      new Error('No local printer on host PC for this job. Check Settings → Printers.'),
      { status: 400, code: 'no_printer' },
    );
  }

  try {
    await sendRawBytesOnWindowsPrinter(printer, buffer);
    logger.info('print', 'host raw print ok', { printer, bytes: buffer.length });
    return { success: true, deviceName: printer, mode: 'host-raw' };
  } catch (err) {
    logger.warn('print', 'host raw print failed', { printer, error: err.message });
    throw Object.assign(
      new Error(err.message || 'Host raw print failed'),
      { status: 500, code: 'print_failed', detail: err.message },
    );
  }
}

/**
 * Accept a base64 PNG/JPEG and print it on the host's local printer.
 */
export async function printBase64ImageOnHost({
  imageBase64,
  mimeType,
  preferredPrinter,
  paperSizeName,
  pageWidthIn,
  pageHeightIn,
  fillPaper = false,
  paperKind = 0,
} = {}) {
  const raw = String(imageBase64 || '').replace(/^data:image\/\w+;base64,/, '');
  if (!raw || raw.length < 100) {
    throw Object.assign(new Error('Invalid print image'), { status: 400 });
  }
  let buffer;
  try {
    buffer = Buffer.from(raw, 'base64');
  } catch {
    throw Object.assign(new Error('Invalid base64 image'), { status: 400 });
  }
  if (buffer.length < 500 || buffer.length > 12_000_000) {
    throw Object.assign(new Error('Print image size out of range'), { status: 400 });
  }

  const printer = await resolveHostInvoicePrinter(preferredPrinter);
  if (!printer) {
    throw Object.assign(
      new Error('No local printer on host PC. Connect Canon to the main PC and set it in Settings → Printers.'),
      { status: 400, code: 'no_printer' },
    );
  }

  const ext = /jpeg|jpg/i.test(String(mimeType || '')) ? '.jpg' : '.png';
  const tempPath = path.join(os.tmpdir(), `ssj-host-print-${Date.now()}${ext}`);
  fs.writeFileSync(tempPath, buffer);
  try {
    await printImageGdi(tempPath, printer, { paperSizeName, pageWidthIn, pageHeightIn, fillPaper, paperKind });
    logger.info('print', 'host print ok', { printer, bytes: buffer.length });
    return { success: true, deviceName: printer, mode: 'host-gdi' };
  } catch (err) {
    logger.warn('print', 'host print failed', { printer, error: err.message });
    throw Object.assign(
      new Error(err.message || 'Host print failed'),
      { status: 500, code: 'print_failed', detail: err.message },
    );
  } finally {
    setTimeout(() => { try { fs.unlinkSync(tempPath); } catch { /* */ } }, 30_000);
  }
}
