import { Image, StyleSheet, Text, View } from 'react-native';
import { AppButton, Notice, Screen, commonStyles } from '../components/ui';
import { useApp } from '../state/AppContext';
import { colors, spacing } from '../theme';

export function OnboardingScreen({ onSignIn }: { onSignIn: () => void }) {
  const { finishOnboarding, cloudConfigured } = useApp();
  return <Screen style={styles.content}>
    <Image source={require('../../assets/mushroom-icon.png')} style={styles.logo} />
    <View style={styles.copy}><Text style={commonStyles.title}>Vaš gobarski dnevnik</Text><Text style={styles.subtitle}>Shranite rastišča, obiske, fotografije in vremenske razmere. Deluje tudi brez računa in brez povezave.</Text></View>
    <View style={styles.actions}>
      <AppButton title="Nadaljuj v tej napravi" onPress={() => void finishOnboarding()} />
      <AppButton title="Prijava ali nov račun" variant="secondary" disabled={!cloudConfigured} onPress={onSignIn} />
    </View>
    {!cloudConfigured ? <Notice tone="info">Oblak trenutno ni nastavljen. Lokalni dnevnik, zemljevid, fotografije in vreme ostanejo na voljo.</Notice> : null}
    <Text style={commonStyles.muted}>Podatki so privzeto zasebni. Lokalnega dnevnika ne bomo samodejno pripeli računu, če se pozneje prijavite.</Text>
  </Screen>;
}

const styles = StyleSheet.create({
  content: { justifyContent: 'center' }, logo: { width: 160, height: 160, alignSelf: 'center', borderRadius: 36 },
  copy: { gap: spacing.md, alignItems: 'center' }, subtitle: { ...commonStyles.body, textAlign: 'center', color: colors.muted },
  actions: { gap: spacing.md },
});
