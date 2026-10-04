import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const PACKAGE = 'si.mushroomapp.preview';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.join(ROOT, 'perf-output');
const HELP = `Android performance check (no root, no touch automation)
  npm run perf:android -- check
  npm run perf:android -- reset baseline
  [Use the app manually for 20-30 seconds]
  npm run perf:android -- capture baseline
  npm run perf:android -- report
Options: --serial DEVICE (required with multiple devices), --cpu-samples 3 (1-10)
Results: perf-output/<timestamp>-<label>/; missing metrics are null, not zero.
Reset only clears this package's gfxinfo counters; it does NOT clear app data/cache.`;

export function parseArgs(args) {
  if (!args.length || args.includes('--help')) return { command: 'help' };
  const command = args[0];
  if (!['check', 'reset', 'capture', 'report'].includes(command)) throw new Error('Unknown command. Use --help.');
  let label, serial, samples = 3;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--serial') {
      serial = args[++i];
      if (!serial || !/^[a-zA-Z0-9_.:\-]+$/.test(serial)) throw new Error('Invalid device serial.');
    } else if (args[i] === '--cpu-samples') {
      const value = args[++i];
      if (!/^(?:[1-9]|10)$/.test(value ?? '')) throw new Error('--cpu-samples must be 1-10.');
      samples = Number(value);
    } else if (!label && !args[i].startsWith('-')) label = args[i];
    else throw new Error('Unexpected argument. Use --help.');
  }
  if (['reset', 'capture'].includes(command) && !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(label ?? '')) {
    throw new Error('Provide a filename-only scenario label, e.g. overview-cold (letters, digits, _ or -).');
  }
  if (['check', 'report'].includes(command) && label) throw new Error(`${command} does not take a label.`);
  return { command, label, serial, samples };
}

export function selectDevice(output, serial) {
  const devices = output.split(/\r?\n/).map(line => line.match(/^(\S+)\s+(device|unauthorized|offline)\b/))
    .filter(Boolean).map(match => ({ serial: match[1], state: match[2] }));
  if (serial) {
    const selected = devices.find(device => device.serial === serial);
    if (!selected || selected.state !== 'device') throw new Error('Selected device is missing/offline/unauthorized. Unlock it and authorize USB debugging.');
    return selected.serial;
  }
  if (devices.length > 1) throw new Error('Multiple devices: choose one with --serial DEVICE.');
  if (devices.length !== 1 || devices[0].state !== 'device') throw new Error('No authorized device. Connect a phone, enable USB debugging and accept its authorization dialog.');
  return devices[0].serial;
}

const numeric = (text, expression) => {
  const value = text.match(expression)?.[1];
  return value === undefined ? null : Number(value.replaceAll(',', ''));
};
export function parseGfxinfo(text) {
  return {
    // Trust the OS's classification, not an assumed 60 Hz / 16 ms budget.
    totalRenderedFrames: numeric(text, /Total frames rendered:\s*([\d,]+)/i),
    jankyFrames: numeric(text, /^\s*Janky frames:\s*([\d,]+)/mi),
    jankyPct: numeric(text, /^\s*Janky frames:\s*[\d,]+\s*\(([\d.]+)%\)/mi),
    percentilesMs: Object.fromEntries([50, 90, 95, 99].map(p => [p,
      numeric(text, new RegExp(`${p}th percentile:\\s*([\\d.]+)ms`, 'i'))])),
    slowFrames: numeric(text, /^\s*(?:Number of )?Slow frames:\s*([\d,]+)/mi),
    frozenFrames: numeric(text, /^\s*(?:Number of )?Frozen frames:\s*([\d,]+)/mi),
  };
}
export function parseMeminfo(text) {
  const summary = text.split(/App Summary/)[1] ?? '';
  const field = name => numeric(summary, new RegExp(`^\\s*${name}:\\s*([\\d,]+)`, 'mi'));
  return {
    totalPssKb: numeric(text, /TOTAL PSS:\s*([\d,]+)/i) ?? numeric(text, /^\s*TOTAL\s+([\d,]+)/m),
    // Heap PSS columns and App Summary private attribution are different metrics.
    nativeHeapPssKb: numeric(text, /^\s*Native Heap\s+([\d,]+)/m),
    javaHeapPssKb: numeric(text, /^\s*Dalvik Heap\s+([\d,]+)/m),
    summaryKb: { javaHeap: field('Java Heap'), nativeHeap: field('Native Heap'), graphics: field('Graphics'),
      code: field('Code'), stack: field('Stack'), privateOther: field('Private Other'), system: field('System') },
  };
}

// Keep only this package's CPU lines. Never persist other apps/process names.
export function filterCpuinfo(text) {
  return text.split(/\r?\n/).filter(line => /^CPU usage from /i.test(line)
    || line.includes(`/${PACKAGE}:`) || line.includes(`/${PACKAGE} `)).join('\n');
}
export function parseTopCpu(text, pid) {
  let cpuIndex = -1;
  const values = [];
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === 'PID') { cpuIndex = parts.indexOf('%CPU'); if (cpuIndex < 0) cpuIndex = parts.indexOf('CPU%'); }
    else if (parts[0] === String(pid) && cpuIndex >= 0 && /^[\d.]+%?$/.test(parts[cpuIndex] ?? '')) {
      values.push(Number(parts[cpuIndex].replace('%', '')));
    }
  }
  return values;
}
// Strip top's all-system summaries too; retain target PID rows and column headers only.
export function filterTop(text, pid) {
  return text.split(/\r?\n/).filter(line => /^\s*PID\s/.test(line)
    || new RegExp(`^\\s*${pid}\\s`).test(line)).join('\n');
}

function adbPath() {
  const executable = process.platform === 'win32' ? 'adb.exe' : 'adb';
  const roots = [process.env.ANDROID_SDK_ROOT, process.env.ANDROID_HOME,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk')];
  return roots.filter(Boolean).map(root => path.join(root, 'platform-tools', executable)).find(existsSync) ?? executable;
}
export function executeAdb(args, timeout = 15000) {
  return new Promise((resolve, reject) => execFile(adbPath(), args, {
    timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8',
  }, (error, stdout, stderr) => {
    if (error) reject(new Error(`ADB command failed (${error.killed ? 'timeout' : error.code ?? 'unavailable'}). Check device/SDK connection.`));
    else resolve({ stdout, stderr });
  }));
}

export async function connect(options, run = executeAdb) {
  const serial = selectDevice((await run(['devices', '-l'])).stdout, options.serial);
  const shell = async (...args) => (await run(['-s', serial, 'shell', ...args])).stdout;
  if (!(await shell('pm', 'path', PACKAGE)).trim().startsWith('package:')) throw new Error(`${PACKAGE} is not installed on the selected device.`);
  const pid = (await shell('pidof', PACKAGE)).trim();
  if (!/^\d+$/.test(pid)) throw new Error('Open MushroomApp on the phone first (a single main process is required).');
  // PID alone can be recycled; /proc stat starttime binds reset/capture to the same process.
  let startTicks = null;
  try {
    const stat = await shell('cat', `/proc/${pid}/stat`);
    const value = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/)[19];
    if (/^\d+$/.test(value ?? '')) startTicks = value;
  } catch { /* Some OEMs restrict /proc: capture metrics, but do not claim a verified frame interval. */ }
  return { shell, pid: Number(pid), processStartTicks: startTicks,
    deviceToken: createHash('sha256').update(serial).digest('hex').slice(0, 16) };
}
const json = (filename, value) => writeFileSync(filename, JSON.stringify(value, null, 2) + '\n');
const readJson = filename => { try { return JSON.parse(readFileSync(filename, 'utf8')); } catch { return undefined; } };
const intervalValid = (reset, device, label) => Boolean(device.processStartTicks && reset && reset.label === label && reset.pid === device.pid
  && reset.deviceToken === device.deviceToken && reset.processStartTicks === device.processStartTicks);

export async function runMeasurement(options, { run = executeAdb, output = OUTPUT } = {}) {
  const device = await connect(options, run);
  if (options.command === 'check') {
    console.log(`${PACKAGE}: authorized device, running PID ${device.pid}. No user data read.`);
    return;
  }
  const { shell, pid, processStartTicks, deviceToken } = device;
  const resetPath = path.join(output, '.last-reset.json');
  if (options.command === 'reset') {
    const response = await shell('dumpsys', 'gfxinfo', PACKAGE, 'reset');
    if (/permission denial|unknown|can't find|no process|error:/i.test(response)) throw new Error('gfxinfo reset was not supported/successful.');
    mkdirSync(output, { recursive: true });
    json(resetPath, { label: options.label, at: new Date().toISOString(), pid, processStartTicks, deviceToken });
    console.log(`Reset ${options.label}. Perform the manual scenario, then capture ${options.label}. App/cache unchanged.`);
    return;
  }
  // Validate even exported calls, not just CLI parsing, before constructing output paths.
  parseArgs(['capture', options.label]);
  const reset = readJson(resetPath);
  const valid = intervalValid(reset, device, options.label);
  const started = new Date().toISOString();
  mkdirSync(output, { recursive: true });
  const folder = mkdtempSync(path.join(output, `${started.replace(/[:.]/g, '-')}-${options.label}-`));
  const errors = {};
  const capture = async (name, args, filter = value => value) => {
    try {
      const text = await shell(...args);
      if (/permission denial|unknown option|can't find|no process|error:/i.test(text)) throw new Error('unsupported/denied native metric');
      const safe = filter(text);
      writeFileSync(path.join(folder, `${name}.txt`), safe + '\n');
      return safe;
    } catch {
      errors[name] = 'Unavailable (unsupported, timeout or device disconnected).';
      writeFileSync(path.join(folder, `${name}.txt`), errors[name] + '\n');
      return '';
    }
  };
  // Frame interval ends BEFORE slower memory/CPU snapshots. Do not reset between captures.
  const gfx = await capture('gfxinfo', ['dumpsys', 'gfxinfo', PACKAGE, 'framestats']);
  const framesCapturedAt = new Date().toISOString();
  const mem = await capture('meminfo', ['dumpsys', 'meminfo', PACKAGE]);
  const cpuinfo = await capture('cpuinfo', ['dumpsys', 'cpuinfo'], filterCpuinfo);
  const cpuStartedAt = new Date().toISOString();
  const top = await capture('cpu-top', ['top', '-b', '-n', String(options.samples), '-d', '1', '-p', String(pid)], text => filterTop(text, pid));
  const model = (await capture('device-model', ['getprop', 'ro.product.model'])).trim();
  const sdk = (await capture('device-sdk', ['getprop', 'ro.build.version.sdk'])).trim();
  // A restart DURING the capture invalidates interval and snapshot comparability.
  let sameProcess = false;
  try {
    const after = await connect(options, run);
    sameProcess = after.pid === pid && after.processStartTicks === processStartTicks && after.deviceToken === deviceToken;
  } catch { /* Explicitly mark interval invalid, never fabricate a stable process. */ }
  const summary = { schemaVersion: 1, package: PACKAGE, label: options.label, started, framesCapturedAt,
    completedAt: new Date().toISOString(), device: { model, sdk, deviceToken }, pid, processStartTicks,
    interval: { resetAt: valid ? reset.at : null, valid: valid && sameProcess,
      warning: valid && sameProcess ? null : 'Missing/mismatched reset, unverified process start or restarted process. Frame stats are cumulative/unverified for this scenario.' },
    memory: parseMeminfo(mem), frames: parseGfxinfo(gfx),
    cpu: { sampleStartedAt: cpuStartedAt, topSamplesPct: parseTopCpu(top, pid), cpuinfo }, errors,
    limitations: ['gfxinfo is HWUI/window data, not FPS or complete MapLibre OpenGL/GPU profiling.',
      'Framestats is a recent-frame buffer; summary counters cover since-reset only when interval.valid.',
      'CPU capture samples the actions performed DURING capture, not historical scenario CPU.',
      'Unknown/OEM-unreported metrics stay null. No GPS/logcat/diary captured.'] };
  json(path.join(folder, 'summary.json'), summary);
  console.log(`Captured: ${folder}\nPSS: ${summary.memory.totalPssKb ?? 'unavailable'} KiB; OS jank: ${summary.frames.jankyPct ?? 'unavailable'}%`);
  if (summary.interval.warning) console.warn(summary.interval.warning);
  if (Object.keys(errors).length) console.warn('Some metrics unavailable; see summary.json.');
  return summary;
}

export function report(output = OUTPUT) {
  const captures = existsSync(output) ? readdirSync(output, { withFileTypes: true }).filter(entry => entry.isDirectory())
    .map(entry => ({ folder: entry.name, ...readJson(path.join(output, entry.name, 'summary.json')) }))
    .filter(entry => entry.schemaVersion === 1).sort((a, b) => a.started.localeCompare(b.started)) : [];
  if (!captures.length) throw new Error('No captures yet. Run reset + capture first.');
  console.table(captures.map(c => ({ scenario: c.label, time: c.started, pssMiB: c.memory.totalPssKb === null ? null : +(c.memory.totalPssKb / 1024).toFixed(1),
    javaPssKiB: c.memory.javaHeapPssKb, nativePssKiB: c.memory.nativeHeapPssKb, graphicsKiB: c.memory.summaryKb.graphics,
    frames: c.interval.valid ? c.frames.totalRenderedFrames : null, jankPct: c.interval.valid ? c.frames.jankyPct : null,
    cpuSamplesPct: c.cpu.topSamplesPct.join(', '), intervalValid: c.interval.valid, pid: c.pid })));
  json(path.join(output, 'report.json'), captures);
  console.log('No automatic health verdict. Compare the same phone/build/process and settled checkpoints; see docs/performance/ANDROID_SANITY_CHECK.md.');
  return captures;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.command === 'help') console.log(HELP);
    else if (options.command === 'report') report();
    else await runMeasurement(options);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
