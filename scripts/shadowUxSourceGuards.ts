/** Exact strip visibility / source-notice presentation additions. shadowUxSmoke executes the real hooks and camera bridge. */
export function withoutShadowForecastUx(text: string) {
  return text.replace(/\r\n/g, '\n').replace(/^.*SHADOW_UX_BEGIN.*\n[\s\S]*?^.*SHADOW_UX_END.*\n/gm, '')
    .replaceAll(', researchOrigin }', ' }').replaceAll(' researchOrigin={researchOrigin}', '')
    .replaceAll(' {...profileStrip.scrollProps}', '').replaceAll(' {...dateStrip.scrollProps}', '')
    .replaceAll(' key={profileStrip.stripKey}', '').replaceAll(' key={dateStrip.stripKey}', '')
    .replaceAll(' onLayout={profileStrip.itemLayout(item.id)}', '').replaceAll(' onLayout={dateStrip.itemLayout(day.targetLocalDate)}', '');
}
/** Legacy weather/navigation harnesses isolate this new child hook; actual measurement/effect ordering is tested separately. */
export const selectedStripStub = { useSelectedStrip: () => ({ scrollProps: {}, itemLayout: () => () => {} }) };
