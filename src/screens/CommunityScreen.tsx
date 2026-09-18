import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AppButton, Card, Chip, EmptyState, Notice, commonStyles } from '../components/ui';
import { useApp } from '../state/AppContext';
import { loadCommunityCards, type FeedCard } from '../services/community';
import { slDateTime } from '../domain/format';
import { colors, spacing } from '../theme';

export function CommunityScreen() {
  const { session, cloudConfigured } = useApp();
  const [scope, setScope] = useState<'friends' | 'community'>('friends');
  const [cards, setCards] = useState<FeedCard[]>([]); const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false); const [error, setError] = useState<string>();
  const load = useCallback(async (reset = true) => {
    if (!session) return;
    setLoading(true); setError(undefined);
    try {
      const nextPage = reset ? 0 : page + 1;
      const enriched = await loadCommunityCards(scope, nextPage * 20);
      setCards((current) => reset ? enriched : [...current, ...enriched]); setPage(nextPage);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Objav ni mogoče naložiti.'); }
    finally { setLoading(false); }
  }, [page, scope, session]);
  useEffect(() => { void load(true); }, [scope, session?.user.id]);
  if (!cloudConfigured) return <ScrollView contentContainerStyle={styles.screen}><Text style={commonStyles.title}>Skupnost</Text><EmptyState title="Oblak ni nastavljen" message="Dnevnik deluje lokalno. Za prijatelje in skupnost nastavite Supabase." /></ScrollView>;
  if (!session) return <ScrollView contentContainerStyle={styles.screen}><Text style={commonStyles.title}>Skupnost</Text><EmptyState title="Prijava je potrebna" message="Prijavite se za resnične objave prijateljev in skupnosti. Lažne vsebine niso prikazane." /></ScrollView>;
  return <ScrollView contentContainerStyle={styles.screen} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load(true)} tintColor={colors.primary} />}><Text style={commonStyles.title}>Skupnost</Text><View style={commonStyles.wrap}><Chip label="Prijatelji" selected={scope === 'friends'} onPress={() => setScope('friends')} /><Chip label="Skupnost" selected={scope === 'community'} onPress={() => setScope('community')} /></View>{error ? <Notice tone="warning">{error}</Notice> : null}{cards.map((card) => <Card key={card.findId}><View><Text style={commonStyles.heading}>{card.displayName || `@${card.username}`}</Text><Text style={commonStyles.muted}>@{card.username} · {slDateTime(card.observedAt)} · {card.locationName || (scope === 'friends' ? 'lokacija je deljena s prijatelji' : 'natančna lokacija ni javna')}</Text></View><Text style={commonStyles.body}>{card.species.join(', ') || 'Obisk brez navedene vrste'}</Text>{card.quantities?.length ? <Text style={commonStyles.muted}>{card.quantities.join(' · ')}</Text> : null}{card.temperatureC != null ? <Text style={commonStyles.muted}>Ocenjena temperatura: {card.temperatureC.toFixed(1)} °C</Text> : null}{card.notes ? <Text style={commonStyles.body}>{card.notes}</Text> : null}<View style={commonStyles.wrap}>{card.signedPhotoUrls?.map((url) => <Image key={url} source={{ uri: url }} style={styles.photo} />)}</View></Card>)}{!loading && !cards.length ? <EmptyState title={scope === 'friends' ? 'Ni objav prijateljev' : 'Ni javnih objav'} message="Prikazane so le objave, ki jih lastniki dejansko delijo." /> : null}{loading ? <ActivityIndicator color={colors.primary} /> : null}{cards.length >= 20 ? <AppButton title="Naloži več" variant="secondary" loading={loading} onPress={() => void load(false)} /> : null}<Text style={commonStyles.muted}>Objave skupnosti namenoma ne vsebujejo GPS koordinat. Natančne lokacije so na voljo le lastniku oziroma sprejetim prijateljem, kadar jih lastnik tako označi.</Text></ScrollView>;
}
const styles = StyleSheet.create({ screen: { padding: spacing.lg, gap: spacing.lg, flexGrow: 1, backgroundColor: colors.background }, photo: { width: 100, height: 100, borderRadius: 12, backgroundColor: colors.surfaceSoft } });
