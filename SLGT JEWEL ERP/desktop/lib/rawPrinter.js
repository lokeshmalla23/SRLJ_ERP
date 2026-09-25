const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const os = require('os');
const path = require('path');

const execFileAsync = promisify(execFile);

/**
 * Send raw bytes (TSPL/ZPL/bitmap) to a Windows printer via the spooler RAW datatype.
 * Works with TSC TE244 when the Windows driver is installed.
 * Accepts Buffer / Uint8Array / ASCII string. Payload is written to a temp file
 * so large BITMAP jobs are not truncated by the PowerShell command-line limit.
 */
async function sendRawToWindowsPrinter(printerName, rawPayload) {
  const name = String(printerName || '').trim();
  if (!name) throw new Error('Printer name required');

  let bytes;
  if (Buffer.isBuffer(rawPayload)) {
    bytes = rawPayload;
  } else if (rawPayload instanceof Uint8Array) {
    bytes = Buffer.from(rawPayload);
  } else if (rawPayload && typeof rawPayload === 'object' && rawPayload.type === 'Buffer' && Array.isArray(rawPayload.data)) {
    bytes = Buffer.from(rawPayload.data);
  } else {
    // ASCII/TSPL text — latin1 so each char is one byte (never UTF-8-corrupt dashes).
    const payload = String(rawPayload || '');
    if (!payload) throw new Error('Empty print data');
    bytes = Buffer.from(payload, 'latin1');
  }
  if (!bytes.length) throw new Error('Empty print data');

  const safeName = name.replace(/'/g, "''");
  const tmpBin = path.join(os.tmpdir(), `crm-raw-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`);
  fs.writeFileSync(tmpBin, bytes);

  const safePath = tmpBin.replace(/'/g, "''");
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
    di.pDocName = "JewelleryCRM Label";
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

module.exports = { sendRawToWindowsPrinter };
