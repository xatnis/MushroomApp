/** Explicit internal release only. Never persist this flag in .env or public defaults. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAndroidRelease } from './buildAndroidRelease.mjs';

export const INTERNAL_APK = 'MushroomApp-INTERNAL-koroska-seven-day-shadow-v1.apk';
export async function buildKoroskaShadow(build = buildAndroidRelease) {
  const previousFlag = process.env.EXPO_PUBLIC_ENABLE_KOROSKA_SHADOW_PREVIEW;
  const previousDotenv = process.env.EXPO_NO_DOTENV;
  // Gradle's Expo export:embed child inherits THIS process environment. Avoid a local .env override.
  process.env.EXPO_PUBLIC_ENABLE_KOROSKA_SHADOW_PREVIEW = '1';
  process.env.EXPO_NO_DOTENV = '1';
  console.log('INTERNAL research APK: EXPO_PUBLIC_ENABLE_KOROSKA_SHADOW_PREVIEW=1 (public default stays off).');
  try { return await build(INTERNAL_APK); }
  finally {
    if (previousFlag === undefined) delete process.env.EXPO_PUBLIC_ENABLE_KOROSKA_SHADOW_PREVIEW;
    else process.env.EXPO_PUBLIC_ENABLE_KOROSKA_SHADOW_PREVIEW = previousFlag;
    if (previousDotenv === undefined) delete process.env.EXPO_NO_DOTENV;
    else process.env.EXPO_NO_DOTENV = previousDotenv;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await buildKoroskaShadow(); }
  catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
}
