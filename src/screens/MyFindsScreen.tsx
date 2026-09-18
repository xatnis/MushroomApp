import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Card, Chip, EmptyState, Field, Screen, StatusPill, commonStyles } from '../components/ui';
import type { RootStackParamList } from '../navigation/types';
import { useApp } from '../state/AppContext';
import { normalizeSearch, speciesName } from '../domain/species';
import { slDateTime } from '../domain/format';

export function MyFindsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { finds, hotspots } = useApp();
  const [query, setQuery] = useState('');
  const [period, setPeriod] = useState<'all' | 'year'>('all');
  const filtered = useMemo(() => finds.filter((find) => {
    const hotspot = hotspots.find((item) => item.id === find.hotspotId);
    const haystack = normalizeSearch(`${hotspot?.title ?? ''} ${find.items.map((item) => speciesName(item.speciesId, item.customName)).join(' ')}`);
    return (!query || haystack.includes(normalizeSearch(query))) && (period === 'all' || new Date(find.observedAt).getFullYear() === new Date().getFullYear());
  }), [finds, hotspots, period, query]);
  return <Screen><Text style={commonStyles.title}>Moje najdbe</Text><Field label="Vrsta ali rastišče" value={query} onChangeText={setQuery} placeholder="Išči …" /><View style={commonStyles.wrap}><Chip label="Vse" selected={period === 'all'} onPress={() => setPeriod('all')} /><Chip label="Letos" selected={period === 'year'} onPress={() => setPeriod('year')} /></View>{filtered.length ? filtered.map((find) => <Pressable key={find.id} onPress={() => navigation.navigate('FindDetail', { findId: find.id })}><Card><View style={commonStyles.row}><View style={{ flex: 1 }}><Text style={commonStyles.heading}>{find.outcome === 'nothing' ? 'Nič najdenega' : find.items.map((item) => speciesName(item.speciesId, item.customName)).join(', ') || 'Obisk'}</Text><Text style={commonStyles.muted}>{hotspots.find((item) => item.id === find.hotspotId)?.title || 'Rastišče'} · {slDateTime(find.observedAt)}</Text></View><StatusPill state={find.syncState} /></View></Card></Pressable>) : <EmptyState title="Ni zadetkov" message="Spremenite filter ali zabeležite nov obisk." />}</Screen>;
}
