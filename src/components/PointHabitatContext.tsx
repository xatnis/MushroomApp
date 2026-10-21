import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { MushroomWeatherProfileId } from '../domain/types';
import { resolvePointHabitat, pointHabitatLabel } from '../domain/pointHabitat';
import { slDateTime } from '../domain/format';
import { colors, spacing } from '../theme';

/** Informational sibling of the forecast, never a scorer input. Dates deliberately are NOT dependencies. */
export function PointHabitatContext({ latitude, longitude, profileId, compact = false }: {
  latitude: number; longitude: number; profileId: MushroomWeatherProfileId; compact?: boolean;
}) {
  const context = useMemo(() => resolvePointHabitat(latitude, longitude, profileId), [latitude, longitude, profileId]);
  const [details, setDetails] = useState(false);
  const label = pointHabitatLabel(context.state), p = context.provenance;
  if (compact) return <Text accessibilityLabel={label + '. Regionalni podatek za okolico, ne preverjen habitat točke.'}
    accessibilityLiveRegion="polite" style={styles.compact}>{label}</Text>;
  return <View style={styles.section}>
    <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={styles.heading}>{label}</Text>
    <Text style={styles.body}>Habitat okoliške celice ni preverjen na točki. Vremenska ocena ostaja ločena.</Text>
    {context.state === 'outside-model' ? <Text style={styles.body}>Zunaj habitatnega modela ne pomeni, da gobe tam ne morejo rasti.</Text> : null}
    <Pressable accessibilityRole="button" accessibilityLabel="Viri in omejitve habitata območja" accessibilityState={{ expanded: details }}
      onPress={() => setDetails(value => !value)} style={styles.disclosure}><Text style={styles.action}>{details ? 'Skrij vire habitata' : 'Viri in omejitve habitata'}</Text></Pressable>
    {details ? <View style={styles.section}>
      <Text style={styles.body}>{context.explanation}</Text>
      <Text style={styles.body}>{p.landCover.source} · {p.landCover.vintage} · izvorna ločljivost {p.landCover.resolutionM} m; kartirane celice približno {p.cellSizeM} m. To niso sprotne meritve.</Text>
      <Text style={styles.body}>{p.coverageLabel} · {p.datasetId} · {p.cellCount} obstoječih poligonov; ni popolna pokritost Slovenije.</Text>
      {context.cellId ? <Text selectable style={styles.body}>Regionalna celica: {context.cellId}</Text> : null}
      <Text style={styles.body}>{p.treeComposition.source}. {context.zgsAvailable && context.treeCompositionRetrievedAt
        ? `Zajem podatkov za celico: ${slDateTime(context.treeCompositionRetrievedAt)}.` : 'Za to območje ni potrjenih popolnih podatkov o drevesni sestavi.'} Letnik sestojnih podatkov ni potrjen; čas zajema ni čas opazovanja.</Text>
      <Text style={styles.body}>Drevesna sestava in vegetacijski deleži opisujejo del regionalne celice, ne posamezne točke. Potencialno primeren habitat in ugodno vreme ne potrjujeta prisotnosti gob.</Text>
      <Text style={styles.body}>{p.landCover.attribution}</Text>
      <Text style={styles.body}>{context.contextVersion} · habitatni kontekst je statičen skozi vseh sedem dni.</Text>
    </View> : null}
  </View>;
}
const styles = StyleSheet.create({
  section: { gap: spacing.xs }, heading: { fontSize: 15, fontWeight: '600', color: colors.text }, body: { fontSize: 13, color: colors.text, flexShrink: 1 },
  compact: { fontSize: 13, color: colors.text, flexShrink: 1 }, disclosure: { minHeight: 48, justifyContent: 'center', paddingVertical: spacing.xs },
  action: { fontSize: 14, color: colors.primary, fontWeight: '600', flexShrink: 1 },
});
