import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { MushroomConditionsScore, MushroomWeatherSummary } from '../domain/types';
import { BOLETUS_EDULIS_SCORE_V1_CONFIG, CANTHARELLUS_CIBARIUS_SCORE_V1_CONFIG, MUSHROOM_WEATHER_PROFILES } from '../domain/mushroomWeather';
import { slDateTime, slNumber } from '../domain/format';
import { colors, radii, spacing } from '../theme';
import { Card, commonStyles } from './ui';
import { advancedFactors, advancedInputs } from './conditionsAdvancedPresentation';

export function ConditionsAdvancedDetails({ summary, score, forecastText, onOpenGraphs }: {
  summary?: MushroomWeatherSummary; score: MushroomConditionsScore; forecastText: string; onOpenGraphs: () => void;
}) {
  const [inputsOpen, setInputsOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const profile = MUSHROOM_WEATHER_PROFILES[score.profile];
  const factors = advancedFactors(score);
  return <View style={styles.sections}>
    <Card style={styles.card}>
      <Text accessibilityRole="header" style={commonStyles.heading}>Kako je izračunana ocena?</Text>
      <Text style={commonStyles.body}>{profile.label} · Danes</Text>
      <View style={styles.total}><Text style={styles.score}>{score.score == null ? 'Ni ocene' : `${score.score}/100`}</Text>
        <Text style={commonStyles.heading}>{score.label}</Text></View>
      {score.reasons.slice(0, 2).map(reason => <Text key={reason} style={commonStyles.body}>{reason}</Text>)}
      {!summary ? <Text style={commonStyles.body}>Vremenski podatki za izbrano lokacijo trenutno niso na voljo.</Text> : null}
      {factors.map(factor => <View key={factor.key} accessible accessibilityLabel={`${factor.label}. Prispevek: ${factor.contribution}. ${factor.status}`} style={styles.factor}>
        <View style={styles.row}><Text style={styles.factorName}>{factor.label}</Text><Text style={styles.points}>{factor.contribution}</Text></View>
        {factor.ratio != null ? <View accessible={false} style={styles.track}>
          <View style={[styles.fill, { width: `${factor.ratio * 100}%` }]} />
        </View> : null}
        <Text style={commonStyles.muted}>{factor.status}</Text>
      </View>)}
      <Text style={commonStyles.muted}>Prispevki so prikazani glede na največjo utež posameznega dejavnika, pred morebitnim preračunom. Ob manjkajočih signalih model preostale uteži preračuna na 100 %. Zaokrožene vrstice niso nujno enake končni zaokroženi oceni.</Text>
    </Card>
    <Card style={styles.card}>
      <Disclosure title="Vhodni vremenski podatki" open={inputsOpen} onPress={() => setInputsOpen(v => !v)} />
      {inputsOpen ? <View style={styles.sections}>
        <Text style={commonStyles.muted}>Označeni vhodi pripadajo profilu {profile.label}; dodatni kontekst ni samodejno del njegove ocene.</Text>
        {summary ? advancedInputs(summary, score).map(section => <View key={section.title} style={styles.inputGroup}>
          <Text accessibilityRole="header" style={styles.factorName}>{section.title}</Text>
          {section.rows.map(row => <View key={row.label} style={styles.inputRow}>
            <View style={styles.row}><Text style={styles.inputLabel}>{row.label}</Text><Text style={styles.points}>{row.value}</Text></View>
            <Text style={commonStyles.muted}>{row.usage}{row.coverage ? ` · ${row.coverage}` : ''}</Text>
          </View>)}
        </View>) : <Text style={commonStyles.body}>Ni podatka.</Text>}
        <Text accessibilityRole="header" style={styles.factorName}>Napoved – samo kontekst trenda</Text>
        <Text style={commonStyles.body}>Padavine naslednjih 7 dni: {forecastText}</Text>
        <Text style={commonStyles.body}>Padavine naslednjih 3 dni: {summary?.forecast?.rain3dMm == null || !Number.isFinite(summary.forecast.rain3dMm) ? 'Ni podatka' : `${slNumber(summary.forecast.rain3dMm, 1)} mm`}</Text>
        <Text style={commonStyles.muted}>{profile.forecastNote}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Vremenski grafi za izbrano lokacijo" onPress={onOpenGraphs} style={styles.action}>
          <Text style={styles.actionText}>Vremenski grafi →</Text>
        </Pressable>
      </View> : null}
    </Card>
    <Card style={styles.card}>
      <Disclosure title="Viri in omejitve modela" open={sourcesOpen} onPress={() => setSourcesOpen(v => !v)} />
      {sourcesOpen ? <View style={styles.sections}>
        <Text style={commonStyles.body}>Ocena predstavlja primernost modeliranih pogojev, ne verjetnosti najdbe gob.</Text>
        <Text style={commonStyles.body}>{score.coverage}</Text>
        {summary ? <Text style={commonStyles.muted}>Open-Meteo · posodobljeno {slDateTime(summary.updatedAt)}{summary.stale ? ' · predpomnjeni, lahko zastareli podatki' : ''}</Text> : null}
        <Text style={commonStyles.body}>Pretekli modelski/reanalizirani podatki in pretekle napovedi niso meritve na rastišču. Napoved vključuje nedokončan današnji dan. Vlaga tal je modelirana, ET₀ pa je referenčna evapotranspiracija in približen signal izsuševanja.</Text>
        <Text style={commonStyles.body}>{profile.evidenceNote}</Text>
        {profile.scientificName ? <Text style={commonStyles.muted}>{profile.scientificName}</Text> : null}
        {score.profile === 'boletusEdulis' ? <Text style={commonStyles.muted}>Temperaturna referenca: približno {BOLETUS_EDULIS_SCORE_V1_CONFIG.temperature.optimumC} °C; ni potrjen univerzalni biološki optimum.</Text> : null}
        {score.profile === 'cantharellusCibarius' ? <Text style={commonStyles.muted}>Raziskovalni kontekst: {CANTHARELLUS_CIBARIUS_SCORE_V1_CONFIG.temperature.researchContextMinC}–{CANTHARELLUS_CIBARIUS_SCORE_V1_CONFIG.temperature.researchContextMaxC} °C v eni evropski študiji, ne univerzalna meja.</Text> : null}
        {score.profile === 'lactariusDeliciosus' ? <Text style={commonStyles.muted}>Model uporablja široko jesensko temperaturno območje; temperaturni pragovi niso biološki optimum.</Text> : null}
        {profile.seasonNote ? <Text style={commonStyles.muted}>{profile.seasonNote}</Text> : null}
        {score.reasons.slice(2).map(reason => <Text key={reason} style={commonStyles.muted}>{reason}</Text>)}
        <Text style={commonStyles.muted}>{profile.tuningNote} Model ni znanstveno potrjena napoved uspeha. Manjkajoče komponente se izločijo; razpoložljive uteži se preračunajo.</Text>
        <Text style={commonStyles.muted}>Pred komercialno uporabo preverite pogoje uporabe Open-Meteo in zahtevano navedbo vira.</Text>
      </View> : null}
    </Card>
  </View>;
}

function Disclosure({ title, open, onPress }: { title: string; open: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ expanded: open }} onPress={onPress} style={styles.action}>
    <View style={styles.row}><Text style={styles.disclosureTitle}>{title}</Text><Text accessible={false} style={styles.actionText}>{open ? '⌃' : '⌄'}</Text></View>
  </Pressable>;
}

const styles = StyleSheet.create({
  sections: { gap: spacing.sm }, card: { padding: spacing.md, gap: spacing.sm },
  total: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm }, score: { fontSize: 30, fontWeight: '800', color: colors.primary },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.xs },
  factor: { gap: spacing.xs, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  factorName: { fontSize: 16, color: colors.text, fontWeight: '600', flexShrink: 1 }, points: { fontSize: 16, color: colors.text, fontWeight: '600' },
  track: { height: 6, borderRadius: radii.round, backgroundColor: colors.surfaceSoft, overflow: 'hidden' }, fill: { height: '100%', backgroundColor: colors.primary },
  inputGroup: { gap: spacing.xs }, inputRow: { gap: spacing.xs, paddingVertical: spacing.xs }, inputLabel: { fontSize: 15, color: colors.text, flexShrink: 1 },
  action: { minHeight: 48, justifyContent: 'center', paddingVertical: spacing.xs }, actionText: { fontSize: 16, fontWeight: '600', color: colors.primary },
  disclosureTitle: { fontSize: 16, fontWeight: '600', color: colors.primary, flexShrink: 1 },
});
