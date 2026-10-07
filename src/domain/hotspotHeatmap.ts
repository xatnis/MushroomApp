import type { ConditionsTargetContext } from './hotspotRanking';
import type { HeatmapNavigationState } from './heatmap/navigationState';

/** Typed adapter over existing navigation state, not a second selection store. */
export function conditionsContextFromNavigation(state: Pick<HeatmapNavigationState, 'profileId' | 'targetDay'>): ConditionsTargetContext {
  return { targetProfile: state.profileId, dayMode: state.targetDay };
}
export function conditionsNavigationPatch(context: ConditionsTargetContext): Pick<HeatmapNavigationState, 'profileId' | 'targetDay'> {
  return { profileId: context.targetProfile, targetDay: context.dayMode };
}
