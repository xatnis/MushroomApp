import assert from 'node:assert/strict';
import { parseOutputName } from './buildAndroidRelease.mjs';

assert.equal(parseOutputName([]), 'MushroomApp-preview-latest.apk');
assert.equal(parseOutputName(['--name', 'MushroomApp-preview-build-helper-test.apk']), 'MushroomApp-preview-build-helper-test.apk');
for (const args of [
  ['--name', '../escape.apk'], ['--name', 'nested/escape.apk'], ['--name', 'nested\\escape.apk'],
  ['--name', 'MushroomApp-preview'], ['--wrong', 'name.apk'], ['--name'], ['--name', ''],
]) assert.throws(() => parseOutputName(args));
console.log('APK helper argument validation passed.');
