import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { NavigationContainer, DefaultTheme, type Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { RootStackParamList, TabsParamList } from './types';
import { colors } from '../theme';
import { useApp } from '../state/AppContext';
import { OnboardingScreen } from '../screens/OnboardingScreen';
import { MapScreen } from '../screens/MapScreen';
import { ConditionsScreen } from '../screens/ConditionsScreen';
import { CommunityScreen } from '../screens/CommunityScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { RecordScreen } from '../screens/RecordScreen';
import { HotspotDetailScreen } from '../screens/HotspotDetailScreen';
import { FindDetailScreen } from '../screens/FindDetailScreen';
import { MyFindsScreen } from '../screens/MyFindsScreen';
import { AuthScreen } from '../screens/AuthScreen';
import { FriendsScreen } from '../screens/FriendsScreen';
import { SettingsScreen } from '../screens/SettingsScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<TabsParamList>();
const theme: Theme = { ...DefaultTheme, colors: { ...DefaultTheme.colors, primary: colors.primary, background: colors.background, card: colors.surface, text: colors.text, border: colors.border, notification: colors.accent } };

function AddPlaceholder() { return <View />; }

function MainTabs() {
  const insets = useSafeAreaInsets();
  return <Tabs.Navigator screenOptions={({ route }) => ({
    headerShown: false, tabBarActiveTintColor: colors.primary, tabBarInactiveTintColor: colors.muted,
    tabBarStyle: [styles.tabBar, { height: 62 + insets.bottom, paddingBottom: insets.bottom }],
    tabBarLabelStyle: styles.tabLabel, tabBarItemStyle: [styles.tabItem, route.name === 'Add' && styles.addTabItem], tabBarIconStyle: route.name === 'Add' ? styles.addTabIcon : styles.tabIcon,
    tabBarAllowFontScaling: false, tabBarHideOnKeyboard: true,
    tabBarIcon: ({ color, size }) => {
      const names: Record<keyof TabsParamList, keyof typeof Ionicons.glyphMap> = { Map: 'map-outline', Conditions: 'cloud-outline', Add: 'add-circle', Community: 'people-outline', Profile: 'person-outline' };
      if (route.name === 'Add') return <View style={styles.addButton}><Ionicons name="add" size={34} color={colors.white} /></View>;
      return <Ionicons name={names[route.name]} size={size} color={color} />;
    },
  })}>
    <Tabs.Screen name="Map" component={MapScreen} options={{ title: 'Zemljevid' }} />
    <Tabs.Screen name="Conditions" component={ConditionsScreen} options={{ title: 'Razmere' }} />
    <Tabs.Screen name="Add" component={AddPlaceholder} options={{ title: '', tabBarShowLabel: false, tabBarAccessibilityLabel: 'Dodaj obisk' }} listeners={({ navigation }) => ({ tabPress: (event) => { event.preventDefault(); navigation.getParent()?.navigate('Record'); } })} />
    <Tabs.Screen name="Community" component={CommunityScreen} options={{ title: 'Skupnost' }} />
    <Tabs.Screen name="Profile" component={ProfileScreen} options={{ title: 'Profil' }} />
  </Tabs.Navigator>;
}

export function AppNavigator() {
  const { ready, onboarded } = useApp();
  if (!ready) return <View style={styles.loading}><ActivityIndicator size="large" color={colors.primary} /></View>;
  return <NavigationContainer theme={theme} linking={{ prefixes: ['mushroomapp-preview://'], config: { screens: { Auth: 'auth/callback' } } }}>
    <Stack.Navigator initialRouteName={onboarded ? 'Tabs' : 'Onboarding'} screenOptions={{ headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.primary, headerTitleStyle: { fontWeight: '700' }, contentStyle: { backgroundColor: colors.background } }}>
      {!onboarded ? <Stack.Screen name="Onboarding" options={{ headerShown: false }}>{({ navigation }) => <OnboardingScreen onSignIn={() => navigation.navigate('Auth')} />}</Stack.Screen> : null}
      <Stack.Screen name="Tabs" component={MainTabs} options={{ headerShown: false }} />
      <Stack.Screen name="Record" component={RecordScreen} options={{ title: 'Zabeleži obisk', presentation: 'modal' }} />
      <Stack.Screen name="HotspotDetail" component={HotspotDetailScreen} options={{ title: 'Rastišče' }} />
      <Stack.Screen name="FindDetail" component={FindDetailScreen} options={{ title: 'Obisk' }} />
      <Stack.Screen name="MyFinds" component={MyFindsScreen} options={{ title: 'Moje najdbe' }} />
      <Stack.Screen name="Auth" component={AuthScreen} options={{ title: 'Račun' }} />
      <Stack.Screen name="Friends" component={FriendsScreen} options={{ title: 'Prijatelji' }} />
      <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Nastavitve' }} />
    </Stack.Navigator>
  </NavigationContainer>;
}
const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  tabBar: { paddingTop: 5, backgroundColor: colors.surface, borderTopColor: colors.border, overflow: 'visible' },
  tabItem: { paddingVertical: 2 },
  addTabItem: { overflow: 'visible', zIndex: 1 },
  tabIcon: { marginTop: 1 },
  addTabIcon: { height: 56, overflow: 'visible' },
  addButton: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, borderWidth: 3, borderColor: colors.surface, transform: [{ translateY: -10 }], elevation: 7, shadowColor: colors.text, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.24, shadowRadius: 5 },
  tabLabel: { fontSize: 11, lineHeight: 15, fontWeight: '600', marginBottom: 1 },
});
