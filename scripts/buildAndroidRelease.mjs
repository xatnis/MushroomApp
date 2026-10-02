import { spawn } from 'node:child_process';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = path.join(projectRoot, 'android');
const sourceApk = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
const outputDir = path.join(projectRoot, 'output');
const defaultName = 'MushroomApp-preview-latest.apk';

export function parseOutputName(args) {
  if (args.length === 0) return defaultName;
  if (args.length !== 2 || args[0] !== '--name') throw new Error('Usage: npm run apk [-- --name MushroomApp-preview-name.apk]');
  const name = args[1];
  if (!name || path.basename(name) !== name || path.isAbsolute(name) || /[\\/]/.test(name)
    || name.includes('..') || !name.toLowerCase().endsWith('.apk')) {
    throw new Error('APK name must be a filename ending in .apk and must stay inside output/.');
  }
  return name;
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    // .bat files need cmd.exe on Windows. The command is fully static, so no
    // user-provided filename is ever passed through a shell.
    const child = process.platform === 'win32'
      ? spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `${command} ${args.join(' ')}`], { cwd, stdio: 'inherit' })
      : spawn(command, args, { cwd, stdio: 'inherit' });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`Android release build failed (exit code ${code ?? 'unknown'}).`)));
  });
}

async function sourceFingerprint() {
  try {
    const info = await stat(sourceApk);
    return `${info.mtimeMs}:${info.size}`;
  } catch (error) {
    if (error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function buildAndroidRelease(outputName = defaultName) {
  const destination = path.resolve(outputDir, outputName);
  if (!destination.startsWith(`${outputDir}${path.sep}`)) throw new Error('APK destination must stay inside output/.');
  const before = await sourceFingerprint();
  const buildStartedAt = Date.now();
  const gradle = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';

  // Rerun tasks makes a successful invocation produce a fresh release artifact.
  await run(gradle, ['assembleRelease', '--rerun-tasks'], androidDir);

  const after = await sourceFingerprint();
  if (!after) throw new Error(`Release build completed but APK was not found: ${sourceApk}`);
  if (after === before || Number(after.split(':')[0]) < buildStartedAt - 2000) {
    throw new Error('Release build completed but did not produce a fresh APK; output was not copied.');
  }

  await mkdir(outputDir, { recursive: true });
  await copyFile(sourceApk, destination);
  const info = await stat(destination);
  console.log('\nAndroid release build successful.');
  console.log(`APK: ${destination}`);
  console.log(`Size: ${(info.size / 1024 / 1024).toFixed(1)} MiB`);
  return destination;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await buildAndroidRelease(parseOutputName(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
