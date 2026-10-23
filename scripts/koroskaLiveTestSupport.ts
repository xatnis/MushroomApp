import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';
export const liveHookStub = { useKoroskaLive: () => ({ snapshot: undefined, knownDates: undefined, loading: false, stale: false, message: '', refresh: async () => {} }) };
export const jsx = (type: any, props: any, key?: string) => ({ type, props, key });
export const walk = (n: any): any[] => Array.isArray(n) ? n.flatMap(walk) : n?.props ? [n, ...walk(n.props.children)] : [];
export const text = (n: any): string => Array.isArray(n) ? n.map(text).join('') : n?.props ? text(n.props.children) : n == null || typeof n === 'boolean' ? '' : String(n);
export function compileLive(file: string, override: (id: string) => any) {
  const path = resolve(file), here = createRequire(path), Module = here('node:module'), mod = new Module(path);
  mod.filename = path; mod.paths = Module._nodeModulePaths(resolve('src/experimental'));
  mod.require = (id: string) => override(id) ?? (id === 'expo-crypto' ? { CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    digestStringAsync: async (_: string, value: string) => createHash('sha256').update(value).digest('hex') } : here(id));
  mod._compile(ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, path);
  return mod.exports;
}
