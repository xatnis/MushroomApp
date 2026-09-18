import type { NavigatorScreenParams } from '@react-navigation/native';

export type TabsParamList = {
  Map: { focusExploreLocationAt?: number } | undefined;
  Conditions: undefined;
  Add: undefined;
  Community: undefined;
  Profile: undefined;
};

export type RootStackParamList = {
  Onboarding: undefined;
  Tabs: NavigatorScreenParams<TabsParamList> | undefined;
  Record: { hotspotId?: string; latitude?: number; longitude?: number; findId?: string } | undefined;
  HotspotDetail: { hotspotId: string };
  FindDetail: { findId: string };
  MyFinds: undefined;
  Auth: { mode?: 'login' | 'signup' | 'reset' } | undefined;
  Friends: undefined;
  Settings: undefined;
};
