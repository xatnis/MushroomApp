/** User intent is separate from temporary detail-card occlusion.
 * No weather/camera/navigation/render action can reopen a dismissed panel. */
export interface HeatmapControlsState { userDismissedPanel: boolean }
export type HeatmapControlsAction = { type: 'open' | 'dismiss' };
export const INITIAL_HEATMAP_CONTROLS: HeatmapControlsState = { userDismissedPanel: false };
export function heatmapControlsReducer(state: HeatmapControlsState, action: HeatmapControlsAction): HeatmapControlsState {
  if (action.type !== 'open' && action.type !== 'dismiss') return state;
  const userDismissedPanel = action.type === 'dismiss';
  return state.userDismissedPanel === userDismissedPanel ? state : { userDismissedPanel };
}
export const heatmapControlsPanelVisible = (state: HeatmapControlsState, enabled: boolean, detailCardOpen: boolean) =>
  enabled && !state.userDismissedPanel && !detailCardOpen;
