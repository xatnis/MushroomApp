/** User intent is separate from temporary detail-card occlusion.
 * No weather/camera/navigation/render action can reopen a dismissed panel. */
export interface HeatmapControlsState { userDismissedPanel: boolean; beforeHotspotEntry?: boolean; topThreeOpen?: boolean; filterFromTopThree?: boolean }
export type HeatmapControlsAction = { type: 'open' | 'dismiss' | 'hotspot-entry' | 'leave' | 'top-three-open' | 'top-three-close' };
export const INITIAL_HEATMAP_CONTROLS: HeatmapControlsState = { userDismissedPanel: false };
export function heatmapControlsReducer(state: HeatmapControlsState, action: HeatmapControlsAction): HeatmapControlsState {
  if (action.type === 'top-three-open') return { ...state, userDismissedPanel: true, topThreeOpen: true };
  const { topThreeOpen, ...withoutTopThree } = state;
  if (action.type === 'top-three-close') return topThreeOpen ? withoutTopThree : state;
  if (!['open', 'dismiss', 'hotspot-entry', 'leave'].includes(action.type)) return state;
  if (topThreeOpen) state = withoutTopThree;
  // The filter replacing Top 3 must own the overlay even if a regional selection
  // was preserved underneath. Dismiss/leave remove this transient priority.
  if (action.type === 'open' && topThreeOpen) return { ...state, userDismissedPanel: false, filterFromTopThree: true };
  if (action.type === 'dismiss' || action.type === 'leave') {
    const { filterFromTopThree, ...rest } = state;
    if (filterFromTopThree) state = rest;
  }
  if (action.type === 'hotspot-entry') return { userDismissedPanel: true,
    beforeHotspotEntry: state.beforeHotspotEntry ?? state.userDismissedPanel };
  if (action.type === 'leave') return state.beforeHotspotEntry == null ? state
    : { userDismissedPanel: state.beforeHotspotEntry };
  if (action.type !== 'open' && action.type !== 'dismiss') return state;
  const userDismissedPanel = action.type === 'dismiss';
  return state.userDismissedPanel === userDismissedPanel ? state : { ...state, userDismissedPanel };
}
export const heatmapControlsPanelVisible = (state: HeatmapControlsState, enabled: boolean, detailCardOpen: boolean) =>
  enabled && !state.userDismissedPanel && !detailCardOpen && !state.topThreeOpen;

/** A selected hotspot remains selected while the filter temporarily owns the overlay. */
export const hotspotPopupVisible = (selected: boolean, enabled: boolean, filterVisible: boolean, topThreeOpen = false) =>
  selected && !topThreeOpen && (!enabled || !filterVisible);

/** Insets come from actual overlay layouts, not geographic offsets. Leave a touch-sized map area. */
export function hotspotFocusPadding(mapHeight: number, popupHeight: number, popupBottom: number, contextBottom: number, gap: number, markerHeight = 0) {
  // Bottom-anchored annotation extends UP from its coordinate. Reserve its real
  // frame height above the padded camera center, not an arbitrary geographic offset.
  const top = Math.max(0, contextBottom + gap + markerHeight);
  return { top, right: 0, left: 0, bottom: Math.max(0, Math.min(popupHeight + popupBottom + gap, mapHeight - top - (markerHeight > 0 ? 0 : 44))) };
}
