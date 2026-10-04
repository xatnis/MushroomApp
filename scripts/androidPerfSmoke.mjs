// Synthetic parser/transport tests only. These are NOT physical-device benchmarks.
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PACKAGE, parseArgs, selectDevice, parseGfxinfo, parseMeminfo, filterCpuinfo, filterTop, parseTopCpu,
  runMeasurement, report } from './androidPerf.mjs';

assert.equal(parseArgs(['capture', 'lod-cycle-5', '--cpu-samples', '10']).samples, 10);
assert.equal(parseArgs(['reset', 'baseline', '--serial', '192.168.1.2:5555']).label, 'baseline');
for (const label of ['../leak', 'a/b', 'a\\b', 'C:\\x', '.', 'a;echo', '-oops']) {
  assert.throws(() => parseArgs(['capture', label]));
}
for (const samples of ['0', '11', '3x', '1.5']) assert.throws(() => parseArgs(['capture', 'ok', '--cpu-samples', samples]));
assert.throws(() => parseArgs(['capture', 'ok', '--serial', 'x;reboot']));
assert.throws(() => parseArgs(['reset']));
assert.throws(() => selectDevice('List of devices attached\n'));
assert.throws(() => selectDevice('private-phone unauthorized\n'));
assert.throws(() => selectDevice('a device\nb device\n'));
assert.equal(selectDevice('a device\nb offline\n', 'a'), 'a');
assert.equal(selectDevice('List of devices attached\na device model:Redmi\n'), 'a');

const gfx = `Total frames rendered: 1,000\nJanky frames: 25 (2.50%)\nJanky frames (legacy): 100 (10%)
50th percentile: 5ms\n90th percentile: 12ms\n95th percentile: 15ms\n99th percentile: 22ms`;
assert.equal(parseGfxinfo(gfx).totalRenderedFrames, 1000);
assert.equal(parseGfxinfo(gfx).jankyPct, 2.5);
assert.equal(parseGfxinfo(gfx).percentilesMs[99], 22);
assert.equal(parseGfxinfo(gfx).frozenFrames, null);
assert.equal(parseGfxinfo('OEM unsupported').jankyFrames, null);
assert.equal(parseGfxinfo('Total frames rendered: 0\nJanky frames: 0 (0.00%)').jankyFrames, 0);
const mem = `Native Heap   12000 11000 0 24000 22000 2000
Dalvik Heap 8000 7900 0 18000 12000 6000
TOTAL 30000 20000
App Summary
Java Heap: 7900
Native Heap: 11000
Graphics: 3000
Code: 1000
Stack: 800
Private Other: 1100
System: 6200
TOTAL PSS: 30000 TOTAL RSS: 40000`;
assert.equal(parseMeminfo(mem).totalPssKb, 30000);
assert.equal(parseMeminfo(mem).nativeHeapPssKb, 12000);
assert.equal(parseMeminfo(mem).summaryKb.nativeHeap, 11000);
assert.equal(parseMeminfo('TOTAL 14000 12000').totalPssKb, 14000);
assert.equal(parseMeminfo('').summaryKb.graphics, null);
const top = `Tasks: secret other app\nPID USER PR NI VIRT RES SHR S %CPU %MEM TIME+ ARGS
1234 user 20 0 2G 10M 1M R 25.0 1.0 0:01 ${PACKAGE}
2222 user 20 0 2G 10M 1M R 99.0 1.0 0:01 secret.app
PID USER PR NI VIRT RES SHR S %CPU %MEM TIME+ ARGS
1234 user 20 0 2G 10M 1M R 15.0 1.0 0:01 ${PACKAGE}`;
assert.deepEqual(parseTopCpu(filterTop(top, 1234), 1234), [25, 15]);
assert.ok(!filterTop(top, 1234).includes('secret'));
assert.ok(!filterCpuinfo(`CPU usage from 10ms to 5ms ago\n 25% 1234/${PACKAGE}: 12% user\n 99% 2222/secret.app: 99% user`).includes('secret'));

const output = mkdtempSync(path.join(tmpdir(), 'mushroom-perf-smoke-'));
try {
  let cpuFails = false, memFails = false, statFails = false, start = '777';
  const commands = [];
  const run = async args => {
    commands.push(args);
    if (args[0] === 'devices') return { stdout: 'List of devices attached\nprivate-phone device\n' };
    assert.deepEqual(args.slice(0, 3), ['-s', 'private-phone', 'shell']);
    const cmd = args.slice(3).join(' ');
    let stdout;
    if (cmd === `pm path ${PACKAGE}`) stdout = 'package:/data/app/example/base.apk';
    else if (cmd === `pidof ${PACKAGE}`) stdout = '1234';
    else if (cmd === 'cat /proc/1234/stat') {
      if (statFails) throw new Error('OEM denied /proc access');
      stdout = `1234 (name with space) ${['S', ...Array(18).fill('0'), start].join(' ')}`;
    }
    else if (cmd === `dumpsys gfxinfo ${PACKAGE} reset`) stdout = 'Reset complete';
    else if (cmd === `dumpsys gfxinfo ${PACKAGE} framestats`) stdout = gfx;
    else if (cmd === `dumpsys meminfo ${PACKAGE}`) { if (memFails) throw new Error('disconnected'); stdout = mem; }
    else if (cmd === 'dumpsys cpuinfo') stdout = `CPU usage from 10ms to 5ms ago\n25% 1234/${PACKAGE}: 12% user\n99% 2222/secret.app: 99% user`;
    else if (cmd.startsWith('top ')) { if (cpuFails) throw new Error('unsupported'); stdout = top; }
    else if (cmd === 'getprop ro.product.model') stdout = 'Synthetic test device';
    else if (cmd === 'getprop ro.build.version.sdk') stdout = '34';
    else throw new Error(`Unexpected command: ${cmd}`);
    return { stdout };
  };
  await runMeasurement(parseArgs(['reset', 'baseline']), { run, output });
  const baseline = await runMeasurement(parseArgs(['capture', 'baseline']), { run, output });
  assert.equal(baseline.interval.valid, true);
  assert.equal(baseline.memory.totalPssKb, 30000);
  start = '888'; cpuFails = true; memFails = true;
  const restarted = await runMeasurement(parseArgs(['capture', 'baseline']), { run, output });
  assert.equal(restarted.interval.valid, false);
  assert.equal(restarted.memory.totalPssKb, null);
  assert.ok(restarted.errors['cpu-top']);
  assert.deepEqual(restarted.cpu.topSamplesPct, []);
  statFails = true;
  await runMeasurement(parseArgs(['reset', 'restricted']), { run, output });
  const restricted = await runMeasurement(parseArgs(['capture', 'restricted']), { run, output });
  assert.equal(restricted.interval.valid, false);
  assert.equal(restricted.processStartTicks, null);
  assert.equal(report(output).length, 3);
  const recorded = readdirSync(output, { recursive: true }).filter(name => !name.endsWith('.txt') && name.endsWith('.json'))
    .map(name => readFileSync(path.join(output, name), 'utf8')).join('');
  assert.ok(!recorded.includes('private-phone'));
  assert.ok(!recorded.includes('secret.app'));
  assert.ok(commands.every(args => !args.includes('logcat') && !args.includes('clear') && !args.includes('location')));
  const disconnected = path.join(output, 'no-device');
  await assert.rejects(runMeasurement(parseArgs(['capture', 'missing']), {
    output: disconnected, run: async () => ({ stdout: 'List of devices attached\n' }),
  }));
  assert.equal(existsSync(disconnected), false);
} finally {
  // Exact mkdtemp child only; never delete project outputs or a shared temp root.
  assert.equal(path.dirname(output), path.resolve(tmpdir()));
  assert.ok(path.basename(output).startsWith('mushroom-perf-smoke-'));
  rmSync(output, { recursive: true, force: true });
}
console.log('Android perf helper smoke: PASS (synthetic fixtures only; no device results).');
