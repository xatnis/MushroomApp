import {
  DEFAULT_HEATMAP_NAVIGATION_STATE,
  patchHeatmapNavigationState,
} from '../src/domain/heatmap/navigationState';

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};

const selectedAreaId = 'habitat-18-24';
const enteredFromMap = patchHeatmapNavigationState(DEFAULT_HEATMAP_NAVIGATION_STATE, {
  enabled: true,
  profileId: 'boletusEdulis',
  targetDay: 'today',
  selectedAreaId,
  viewport: { center: [14.85, 46.47], zoom: 11.5 },
});

// Entering Conditions does not mutate the persistent heatmap selection.
const returnedFromConditions = patchHeatmapNavigationState(enteredFromMap, {});
assert(returnedFromConditions.enabled, 'Heatmap must remain enabled after returning from Conditions.');
assert(returnedFromConditions.profileId === 'boletusEdulis', 'Species selection must survive navigation.');
assert(returnedFromConditions.targetDay === 'today', 'Target date must survive navigation.');
assert(returnedFromConditions.selectedAreaId === selectedAreaId, 'Selected area must survive navigation.');
assert(returnedFromConditions.viewport?.zoom === 11.5, 'Heatmap viewport must survive a MapScreen remount.');

// The date control inside the selected-area card writes to the same shared state.
const tomorrowFromAreaCard = patchHeatmapNavigationState(returnedFromConditions, { targetDay: 'tomorrow' });
assert(tomorrowFromAreaCard.targetDay === 'tomorrow', 'Area-card date switch must update the shared heatmap date.');
assert(tomorrowFromAreaCard.selectedAreaId === selectedAreaId, 'Area-card date switch must keep the selected area open.');
assert(tomorrowFromAreaCard.profileId === 'boletusEdulis', 'Area-card date switch must preserve the selected species.');
assert(tomorrowFromAreaCard.viewport?.zoom === 11.5, 'Area-card date switch must preserve the map viewport.');

const chanterelleTomorrow = patchHeatmapNavigationState(tomorrowFromAreaCard, {
  profileId: 'cantharellusCibarius',
  targetDay: 'tomorrow',
});
assert(
  chanterelleTomorrow.profileId === 'cantharellusCibarius' && chanterelleTomorrow.targetDay === 'tomorrow',
  'Lisička + jutri must survive navigation independently from Conditions profile.',
);

const disabled = patchHeatmapNavigationState(chanterelleTomorrow, { enabled: false });
assert(!disabled.enabled && disabled.selectedAreaId == null, 'Disabling the heatmap must only clear its selected area.');
assert(
  disabled.profileId === 'cantharellusCibarius' && disabled.targetDay === 'tomorrow' && disabled.viewport?.zoom === 11.5,
  'Switching to Rastišča must preserve heatmap species, date, and viewport for the next Pogoji entry.',
);

const reopenedConditions = patchHeatmapNavigationState(disabled, { enabled: true });
assert(
  reopenedConditions.enabled && reopenedConditions.profileId === 'cantharellusCibarius' && reopenedConditions.targetDay === 'tomorrow',
  'Switching back to Pogoji must restore the previous species and target date.',
);

console.info('Heatmap navigation smoke tests passed', {
  selectedAreaId: returnedFromConditions.selectedAreaId,
  profile: chanterelleTomorrow.profileId,
  targetDay: chanterelleTomorrow.targetDay,
  viewport: returnedFromConditions.viewport,
});
