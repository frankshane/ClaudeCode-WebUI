import { spawn, type ChildProcess } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import type { PickFolderResult } from '../../shared/protocol.ts';

/**
 * Opens the OS folder dialog on this machine: the browser can't hand out absolute paths, so the server
 * shows the dialog (Explorer on Windows, Finder on macOS, zenity/kdialog on Linux) and returns the choice.
 */

const TITLE = '选择项目文件夹';

/** The newest request; an older one still starting up gives way to it. */
let latest: string | null = null;
/** The dialog on screen. Only one at a time: a new request replaces it (say, one lost behind other windows). */
let active: { id: string; child: ChildProcess } | null = null;

/** Shows the dialog, starting in the folder that contains `near` (the current project) when there is one. */
export async function pickFolder(id: string, near?: string): Promise<PickFolderResult> {
  latest = id;
  const start = await startDir(near);
  if (latest !== id) return { status: 'cancelled' };
  const launch = launcher(start);
  if (!launch) return { status: 'unavailable', reason: '这个系统上没有可用的文件夹选择窗口' };
  cancelPick();
  return launch(id);
}

/** Closes the dialog of request `id`, or whichever is open when no id is given. */
export function cancelPick(id?: string): void {
  if (id !== undefined && latest === id) latest = null;
  if (!active || (id !== undefined && active.id !== id)) return;
  active.child.kill();
  active = null;
}

async function startDir(near?: string): Promise<string> {
  for (const dir of near ? [dirname(near), near] : []) {
    if (await isDir(dir)) return dir;
  }
  return homedir();
}

async function isDir(path: string): Promise<boolean> {
  return stat(path).then((s) => s.isDirectory(), () => false);
}

type Launch = (id: string) => Promise<PickFolderResult>;

function launcher(start: string): Launch | null {
  switch (process.platform) {
    case 'win32':
      return (id) => windows(id, start);
    case 'darwin':
      return (id) => mac(id, start);
    case 'linux':
      return process.env.DISPLAY || process.env.WAYLAND_DISPLAY ? (id) => linux(id, start) : null;
    default:
      return null;
  }
}

// ---- process plumbing ----

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
  /** Set when the program couldn't be started (e.g. ENOENT). */
  error?: NodeJS.ErrnoException;
  /** Set when cancelPick() closed the dialog. */
  killed: boolean;
}

function run(id: string, file: string, args: string[], env?: Record<string, string>): Promise<Run> {
  return new Promise((done) => {
    const child = spawn(file, args, { env: { ...process.env, ...env }, windowsHide: true });
    active = { id, child };
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d) => (stderr += d));
    const finish = (code: number | null, error?: NodeJS.ErrnoException) => {
      const killed = active?.child !== child;
      if (!killed) active = null;
      done({ code, stdout, stderr, error, killed });
    };
    child.on('error', (err) => finish(null, err));
    child.on('close', (code) => finish(code));
  });
}

async function picked(raw: string): Promise<PickFolderResult> {
  const path = resolve(raw);
  return (await isDir(path)) ? { status: 'picked', path } : { status: 'unavailable', reason: `选择的不是文件夹：${path}` };
}

function failed(r: Run, what: string): PickFolderResult {
  if (r.stderr.trim()) console.error(`[ccwebui] ${what} failed:`, r.stderr.trim());
  return { status: 'unavailable', reason: r.error ? `无法启动${what}（${r.error.code ?? r.error.message}）` : `${what}出错` };
}

// ---- Windows: the Explorer-style folder dialog (IFileOpenDialog), via PowerShell ----

const WINDOWS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class CcwebuiFolderPicker {
  [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")] class FileOpenDialog {}

  [ComImport, Guid("d57c7288-d4ad-4768-be02-9d969532d960"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IFileOpenDialog {
    [PreserveSig] int Show(IntPtr owner);
    void SetFileTypes(uint count, IntPtr specs);
    void SetFileTypeIndex(uint index);
    void GetFileTypeIndex(out uint index);
    void Advise(IntPtr events, out uint cookie);
    void Unadvise(uint cookie);
    void SetOptions(uint options);
    void GetOptions(out uint options);
    void SetDefaultFolder(IShellItem item);
    void SetFolder(IShellItem item);
    void GetFolder(out IShellItem item);
    void GetCurrentSelection(out IShellItem item);
    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
    void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string name);
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
    void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
    void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
    void GetResult(out IShellItem item);
    void AddPlace(IShellItem item, int where);
    void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string ext);
    void Close(int hr);
    void SetClientGuid(ref Guid guid);
    void ClearClientData();
    void SetFilter(IntPtr filter);
    void GetResults(out IntPtr items);
    void GetSelectedItems(out IntPtr items);
  }

  [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellItem {
    void BindToHandler(IntPtr ctx, ref Guid handler, ref Guid iid, out IntPtr result);
    void GetParent(out IShellItem parent);
    void GetDisplayName(uint form, [MarshalAs(UnmanagedType.LPWStr)] out string name);
    void GetAttributes(uint mask, out uint attributes);
    void Compare(IShellItem other, uint hint, out int order);
  }

  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  static extern void SHCreateItemFromParsingName(string path, IntPtr ctx, [MarshalAs(UnmanagedType.LPStruct)] Guid iid, out IShellItem item);

  const uint FOS_PICKFOLDERS = 0x20, FOS_FORCEFILESYSTEM = 0x40, FOS_PATHMUSTEXIST = 0x800;
  const uint SIGDN_FILESYSPATH = 0x80058000;
  const int ERROR_CANCELLED = unchecked((int)0x800704C7);

  public static string Pick(IntPtr owner, string title, string start) {
    IFileOpenDialog dialog = (IFileOpenDialog)new FileOpenDialog();
    uint options;
    dialog.GetOptions(out options);
    dialog.SetOptions(options | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST);
    dialog.SetTitle(title);
    if (!String.IsNullOrEmpty(start)) {
      try {
        IShellItem folder;
        SHCreateItemFromParsingName(start, IntPtr.Zero, typeof(IShellItem).GUID, out folder);
        dialog.SetFolder(folder);
      } catch (Exception) {}
    }
    int hr = dialog.Show(owner);
    if (hr == ERROR_CANCELLED) return null;
    Marshal.ThrowExceptionForHR(hr);
    IShellItem result;
    dialog.GetResult(out result);
    string path;
    result.GetDisplayName(SIGDN_FILESYSPATH, out path);
    return path;
  }
}
'@
# An invisible topmost owner keeps the dialog above the browser, even though this process isn't in front.
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.FormBorderStyle = 'None'
$owner.Opacity = 0
$owner.StartPosition = 'CenterScreen'
$owner.Size = New-Object System.Drawing.Size(1, 1)
$owner.Show()
$owner.Activate()
$path = [CcwebuiFolderPicker]::Pick($owner.Handle, $env:CCWEBUI_PICK_TITLE, $env:CCWEBUI_PICK_START)
$owner.Close()
# Base64 keeps non-ASCII paths intact whatever the console code page is.
if ($path) { 'OK:' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($path)) } else { 'CANCEL' }
`;

async function windows(id: string, start: string): Promise<PickFolderResult> {
  const encoded = Buffer.from(WINDOWS_SCRIPT, 'utf16le').toString('base64');
  const r = await run(
    id,
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { CCWEBUI_PICK_TITLE: TITLE, CCWEBUI_PICK_START: start },
  );
  if (r.killed) return { status: 'cancelled' };
  const out = r.stdout.trim().split(/\r?\n/).pop() ?? '';
  if (r.code === 0 && out === 'CANCEL') return { status: 'cancelled' };
  if (r.code === 0 && out.startsWith('OK:')) return picked(Buffer.from(out.slice(3), 'base64').toString('utf8'));
  return failed(r, '文件夹选择窗口');
}

// ---- macOS: Finder's "choose folder" ----

async function mac(id: string, start: string): Promise<PickFolderResult> {
  const script = [
    'on run argv',
    // Brings osascript forward so the dialog doesn't open behind the browser.
    'activate',
    `return POSIX path of (choose folder with prompt "${TITLE}" default location (POSIX file (item 1 of argv)))`,
    'end run',
  ];
  const r = await run(id, 'osascript', [...script.flatMap((line) => ['-e', line]), start]);
  if (r.killed || (r.code === 1 && r.stderr.includes('-128'))) return { status: 'cancelled' };
  if (r.code === 0 && r.stdout.trim()) return picked(r.stdout.trim().replace(/(.)\/$/, '$1'));
  return failed(r, 'Finder 选择窗口');
}

// ---- Linux: zenity (GNOME) or kdialog (KDE) ----

async function linux(id: string, start: string): Promise<PickFolderResult> {
  const tools: Array<[string, string[]]> = [
    ['zenity', ['--file-selection', '--directory', `--title=${TITLE}`, `--filename=${start}/`]],
    ['kdialog', ['--getexistingdirectory', start, '--title', TITLE]],
  ];
  for (const [file, args] of tools) {
    const r = await run(id, file, args);
    if (r.error?.code === 'ENOENT') continue;
    if (r.killed || r.code === 1) return { status: 'cancelled' };
    if (r.code === 0 && r.stdout.trim()) return picked(r.stdout.trim());
    return failed(r, file);
  }
  return { status: 'unavailable', reason: '没有找到 zenity 或 kdialog，请手动输入路径' };
}
