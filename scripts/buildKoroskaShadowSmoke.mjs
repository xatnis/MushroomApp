import { strictEqual, rejects } from 'node:assert';
import { buildKoroskaShadow, INTERNAL_APK } from './buildKoroskaShadow.mjs';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const before = process.env.EXPO_PUBLIC_ENABLE_KOROSKA_SHADOW_PREVIEW;
const dotenv = process.env.EXPO_NO_DOTENV;
await buildKoroskaShadow(async name => {
  strictEqual(name, INTERNAL_APK); strictEqual(process.env.EXPO_PUBLIC_ENABLE_KOROSKA_SHADOW_PREVIEW, '1');
  strictEqual(process.env.EXPO_NO_DOTENV, '1'); return 'fixture-no-apk';
});
strictEqual(process.env.EXPO_PUBLIC_ENABLE_KOROSKA_SHADOW_PREVIEW, before); strictEqual(process.env.EXPO_NO_DOTENV, dotenv);
await rejects(buildKoroskaShadow(async () => { throw Error('fixture build failure'); }), /fixture build failure/);
strictEqual(process.env.EXPO_PUBLIC_ENABLE_KOROSKA_SHADOW_PREVIEW, before); strictEqual(process.env.EXPO_NO_DOTENV, dotenv);
const namespace = flag => {
  const module = { exports: {} };
  runInNewContext(readFileSync('metro.config.js', 'utf8'), { module, __dirname: process.cwd(),
    process: { env: { EXPO_PUBLIC_ENABLE_KOROSKA_SHADOW_PREVIEW: flag } }, require: () => ({ getDefaultConfig: () => ({ cacheVersion: 'expo-default' }) }) });
  return module.exports.cacheVersion;
};
strictEqual(namespace(undefined), 'expo-default:koroska-shadow-off');
strictEqual(namespace('true'), namespace(undefined)); strictEqual(namespace('0'), namespace(undefined));
strictEqual(namespace('1'), 'expo-default:koroska-shadow-on');
console.log('Internal APK environment inheritance/restoration PASS (no real APK claimed).');
