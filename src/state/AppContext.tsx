import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Linking } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import * as Sharing from 'expo-sharing';
import { useSQLiteContext } from 'expo-sqlite';
import type { Session, User } from '@supabase/supabase-js';
import type { ExploreLocation, FindRecord, Hotspot, ProfileSummary, RecordingDraft } from '../domain/types';
import { DiaryRepository } from '../storage/database';
import { cloudConfigured, supabase } from '../services/supabase';
import { SyncEngine } from '../services/sync';
import { getHistoricalWeather } from '../services/weather';
import { writeExportFile } from '../services/media';
import { signInWithEmail, signOutFromCloud, signUpWithEmail, type SignUpInput, type SignUpResult } from '../services/auth';

interface AppContextValue {
  ready: boolean;
  onboarded: boolean;
  profile: ProfileSummary;
  session?: Session;
  currentUser?: User;
  authLoading: boolean;
  cloudConfigured: boolean;
  hotspots: Hotspot[];
  finds: FindRecord[];
  online: boolean;
  cloudNotice?: string;
  exploreLocation?: ExploreLocation;
  setExploreLocation: (location: ExploreLocation) => void;
  pendingHotspotFocus?: PendingHotspotFocus;
  requestHotspotFocus: (hotspot: Pick<Hotspot, 'id' | 'latitude' | 'longitude'>) => void;
  clearHotspotFocus: (requestId: string) => void;
  repository: DiaryRepository;
  refresh: () => Promise<void>;
  finishOnboarding: () => Promise<void>;
  saveVisit: (input: Parameters<DiaryRepository['saveVisit']>[0]) => Promise<{ hotspotId: string; findId: string }>;
  saveDraft: (draft: RecordingDraft) => Promise<void>;
  clearDraft: () => Promise<void>;
  syncNow: () => Promise<void>;
  retrySync: () => Promise<void>;
  attachLocalDiary: () => Promise<void>;
  useCloudDiary: () => Promise<void>;
  useLocalDiary: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: SignUpInput) => Promise<SignUpResult>;
  signOut: () => Promise<void>;
  logout: () => Promise<void>;
  exportDiary: () => Promise<string>;
}

interface PendingHotspotFocus {
  requestId: string;
  hotspotId: string;
  latitude: number;
  longitude: number;
}

const fallbackProfile: ProfileSummary = { id: 'local:device', mode: 'local', createdAt: new Date().toISOString() };
const AppContext = createContext<AppContextValue | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const repository = useMemo(() => new DiaryRepository(db), [db]);
  const syncEngine = useMemo(() => supabase ? new SyncEngine(db, supabase) : undefined, [db]);
  const [ready, setReady] = useState(false);
  const [onboarded, setOnboarded] = useState(false);
  const [profile, setProfile] = useState<ProfileSummary>(fallbackProfile);
  const [session, setSession] = useState<Session>();
  const [authLoading, setAuthLoading] = useState(cloudConfigured);
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [finds, setFinds] = useState<FindRecord[]>([]);
  const [online, setOnline] = useState(true);
  const [cloudNotice, setCloudNotice] = useState<string>();
  const [exploreLocation, setExploreLocation] = useState<ExploreLocation>();
  const [pendingHotspotFocus, setPendingHotspotFocus] = useState<PendingHotspotFocus>();
  const focusSequence = useRef(0);

  const requestHotspotFocus = useCallback((hotspot: Pick<Hotspot, 'id' | 'latitude' | 'longitude'>) => {
    focusSequence.current += 1;
    setPendingHotspotFocus({
      requestId: `${Date.now()}:${focusSequence.current}`,
      hotspotId: hotspot.id,
      latitude: hotspot.latitude,
      longitude: hotspot.longitude,
    });
  }, []);

  const clearHotspotFocus = useCallback((requestId: string) => {
    setPendingHotspotFocus((current) => current?.requestId === requestId ? undefined : current);
  }, []);

  const refreshFor = useCallback(async (current: ProfileSummary) => {
    const [nextHotspots, nextFinds] = await Promise.all([repository.listHotspots(current.id), repository.listFinds(current.id)]);
    setHotspots(nextHotspots); setFinds(nextFinds);
  }, [repository]);

  const refresh = useCallback(() => refreshFor(profile), [profile, refreshFor]);

  useEffect(() => {
    void (async () => {
      const active = await repository.getActiveProfile();
      setProfile(active);
      setOnboarded((await repository.getSetting(active.id, 'onboarding_complete')) === 'true');
      await refreshFor(active);
      if (supabase) {
        const { data } = await supabase.auth.getSession();
        setSession(data.session ?? undefined);
      }
      setAuthLoading(false);
      setReady(true);
    })();
  }, [repository, refreshFor]);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    const { data } = client.auth.onAuthStateChange((_event, next) => {
      setSession(next ?? undefined);
      setAuthLoading(false);
    });
    const handleUrl = async (url: string | null) => {
      if (!url) return;
      const code = new URL(url).searchParams.get('code');
      if (code) await client.auth.exchangeCodeForSession(code);
    };
    void Linking.getInitialURL().then(handleUrl);
    const link = Linking.addEventListener('url', ({ url }) => void handleUrl(url));
    return () => { data.subscription.unsubscribe(); link.remove(); };
  }, []);

  const syncNow = useCallback(async () => {
    if (!syncEngine || !profile.accountId) return;
    try {
      const hadErrors = await syncEngine.run(profile.accountId);
      setCloudNotice(hadErrors ? 'Nekaterih sprememb ni bilo mogoče poslati v oblak. Lokalni zapisi so varni in aplikacija bo poskusila znova.' : undefined);
      await refreshFor(profile);
    } catch (error) {
      console.warn('[Sync]', error);
      setCloudNotice('Sinhronizacija trenutno ni na voljo. Lokalni zapisi so ostali varno shranjeni.');
    }
  }, [profile, refreshFor, syncEngine]);

  const retrySync = useCallback(async () => {
    if (!syncEngine || !profile.accountId) return;
    await syncEngine.retryFailed(profile.accountId); await refreshFor(profile);
  }, [profile, refreshFor, syncEngine]);

  useEffect(() => {
    const network = NetInfo.addEventListener((state) => {
      const usable = Boolean(state.isConnected && state.isInternetReachable !== false);
      setOnline(usable);
      if (usable) void syncNow();
    });
    const app = AppState.addEventListener('change', (state) => { if (state === 'active') void syncNow(); });
    return () => { network(); app.remove(); };
  }, [syncNow]);

  const saveVisit: AppContextValue['saveVisit'] = useCallback(async (input) => {
    const result = await repository.saveVisit(input);
    await repository.clearDraft(profile.id);
    await refreshFor(profile);
    const find = await repository.getFind(profile.id, result.findId);
    if (find && find.weather.status === 'pending' && online) {
      void getHistoricalWeather(db, find.observationLatitude, find.observationLongitude, find.observedAt)
        .then((weather) => repository.updateWeather(profile, find.id, weather))
        .then(() => refreshFor(profile));
    }
    void syncNow();
    return result;
  }, [db, online, profile, refreshFor, repository, syncNow]);

  const finishOnboarding = useCallback(async () => {
    await repository.setSetting(profile.id, 'onboarding_complete', 'true');
    setOnboarded(true);
  }, [profile.id, repository]);

  const attachLocalDiary = useCallback(async () => {
    if (!session?.user) throw new Error('Najprej se prijavite.');
    const next = await repository.attachLocalDiary(session.user.id, session.user.user_metadata.username, session.user.user_metadata.display_name);
    await repository.setSetting(next.id, 'onboarding_complete', 'true');
    setProfile(next); setOnboarded(true); await refreshFor(next); void syncEngine?.run(session.user.id);
  }, [refreshFor, repository, session, syncEngine]);

  const useCloudDiary = useCallback(async () => {
    if (!session?.user) throw new Error('Najprej se prijavite.');
    const next = await repository.ensureCloudProfile(session.user.id, session.user.user_metadata.username, session.user.user_metadata.display_name);
    await repository.setActiveProfile(next.id); await repository.setSetting(next.id, 'onboarding_complete', 'true');
    setProfile(next); setOnboarded(true); await refreshFor(next); void syncEngine?.run(session.user.id);
  }, [refreshFor, repository, session, syncEngine]);

  const useLocalDiary = useCallback(async () => {
    await repository.setActiveProfile('local:device');
    const next = await repository.getActiveProfile();
    setProfile(next); setOnboarded((await repository.getSetting(next.id, 'onboarding_complete')) === 'true'); await refreshFor(next);
  }, [refreshFor, repository]);

  const logout = useCallback(async () => {
    if (supabase) await signOutFromCloud();
    setSession(undefined); await useLocalDiary();
  }, [useLocalDiary]);

  const signIn = useCallback(async (email: string, password: string) => {
    setAuthLoading(true);
    try {
      const result = await signInWithEmail(email, password);
      setSession(result.data.session ?? undefined);
    } finally { setAuthLoading(false); }
  }, []);

  const signUp = useCallback(async (input: SignUpInput) => {
    setAuthLoading(true);
    try {
      const result = await signUpWithEmail(input);
      if (result.session) setSession(result.session);
      return result;
    } finally { setAuthLoading(false); }
  }, []);

  const exportDiary = useCallback(async () => {
    const payload = await repository.exportData(profile.id);
    const uri = await writeExportFile(payload);
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/json', dialogTitle: 'Izvozi dnevnik MushroomApp' });
    return uri;
  }, [profile.id, repository]);

  return <AppContext.Provider value={{
    ready, onboarded, profile, session, currentUser: session?.user, authLoading, cloudConfigured, hotspots, finds, online, cloudNotice, exploreLocation, setExploreLocation,
    pendingHotspotFocus, requestHotspotFocus, clearHotspotFocus, repository, refresh, finishOnboarding,
    saveVisit, saveDraft: (draft) => repository.saveDraft(profile.id, draft), clearDraft: () => repository.clearDraft(profile.id),
    syncNow, retrySync, attachLocalDiary, useCloudDiary, useLocalDiary, signIn, signUp, signOut: logout, logout, exportDiary,
  }}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp mora biti uporabljen znotraj AppProvider.');
  return context;
}
