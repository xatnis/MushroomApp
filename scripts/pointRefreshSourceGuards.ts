/** Narrow allowlist for diagnostics and equivalent sampler short-circuiting, NOT weather/model changes.
 * pointRefreshSmoke executes old/new hooks and actual production acquisition; numerical goldens stay pinned. */
export function withoutPointDiagnostics(path: string, text: string): string {
  let s = text.replace(/\r\n/g, '\n');
  if (path === 'src/screens/MapScreen.tsx') s = s.replace("import { beginPointTiming } from '../services/pointTiming';\n", '')
    .replace('    if (location) beginPointTiming(location);\n', '');
  if (path === 'src/domain/sevenDayConditions.ts') s = s.replace(', onInputsBuilt?: () => void', '')
    .replace('    onInputsBuilt?.(); // Optional development timing boundary; no input/result mutation.\n', '');
  if (path === 'src/domain/soilSampling.ts') s = s.replace("    // Reject instants that cannot be selected BEFORE the expensive IANA clock conversion.\n    // The exact/as-of eligibility, local-date and duplicate checks below remain identical.\n    const eligible = instant != null && (mode.kind === 'morning' ? instant === target : instant <= target && target - instant < 3600000);\n    return eligible && ljubljanaClock(instant!).startsWith(date + 'T') ? [{ time, index, instant: instant! }] : [];",
    "    return instant != null && ljubljanaClock(instant).startsWith(date + 'T') ? [{ time, index, instant }] : [];");
  if (path === 'src/services/weather.ts') s = s.replace(", onTiming?: (stage: 'start' | 'response' | 'decoded') => void", '')
    .replace("  onTiming?: (stage: 'start' | 'response' | 'decoded') => void,\n", '')
    .replace("  onTiming?.('start');\n", '').replace("    onTiming?.('response');\n", '')
    .replace("    const data = await response.json() as T;\n    onTiming?.('decoded');\n    return data;", '    return await response.json() as T;')
    .replace('fetchOpenMeteoJson<T>(url, key, requestTimeoutMs, onTiming)', 'fetchOpenMeteoJson<T>(url, key, requestTimeoutMs)');
  return s;
}
