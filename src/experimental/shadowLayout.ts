import type { ShadowArtifact } from './koroskaShadowData';
export interface ShadowFrame { y: number; height: number }
export interface ShadowRegionRequest { bounds: [number, number, number, number]; padding: { top: number; bottom: number; left: number; right: number } }
/** Whole prepared polygons extend past their representative-centre selection bbox. Compute once per asset. */
export function shadowGeometryBounds(artifact: ShadowArtifact): ShadowRegionRequest['bounds'] {
  const bounds: ShadowRegionRequest['bounds'] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const cell of artifact.cells) {
    const polygons = cell.geometry.type === 'Polygon' ? [cell.geometry.coordinates] : cell.geometry.coordinates;
    for (const polygon of polygons) for (const ring of polygon) for (const [x, y] of ring) {
      bounds[0] = Math.min(bounds[0], x); bounds[1] = Math.min(bounds[1], y); bounds[2] = Math.max(bounds[2], x); bounds[3] = Math.max(bounds[3], y);
    }
  }
  return bounds;
}
/** Frames are relative to the actual map overlay, already inside app safe areas/tab bar. */
export function shadowRegionRequest(bounds: ShadowRegionRequest['bounds'], viewport: { width: number; height: number }, top?: ShadowFrame, bottom?: ShadowFrame, margin = 8): ShadowRegionRequest | undefined {
  if (!top || ![viewport.width, viewport.height, top.y, top.height, margin, ...(bottom ? [bottom.y, bottom.height] : [])].every(Number.isFinite)
    || viewport.width <= 0 || viewport.height <= 0 || top.height < 0 || margin < 0 || !bounds.every(Number.isFinite)) return;
  const padding = { top: Math.ceil(top.y + top.height + margin), bottom: Math.ceil(bottom ? viewport.height - bottom.y + margin : margin * 3), left: margin * 2, right: margin * 2 };
  if (viewport.height - padding.top - padding.bottom < 48 || viewport.width - padding.left - padding.right < 48) return;
  return { bounds, padding };
}
