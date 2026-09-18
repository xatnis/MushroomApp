import type { ExpoConfig, ConfigContext } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'MushroomApp',
  slug: 'mushroom-app-preview',
  version: '1.0.0',
  scheme: 'mushroomapp-preview',
  orientation: 'portrait',
  icon: './assets/mushroom-icon.png',
  userInterfaceStyle: 'light',
  ios: { supportsTablet: true, bundleIdentifier: 'si.mushroomapp.preview' },
  android: {
    package: 'si.mushroomapp.preview',
    permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'CAMERA'],
    adaptiveIcon: { backgroundColor: '#F7F3E8', foregroundImage: './assets/mushroom-icon.png' },
    predictiveBackGestureEnabled: false,
  },
  web: { favicon: './assets/mushroom-icon.png' },
  plugins: [
    '@maplibre/maplibre-react-native',
    'expo-sqlite', 'expo-sharing', 'expo-secure-store', '@react-native-community/datetimepicker',
    ['expo-location', { locationWhenInUsePermission: 'Dovolite MushroomApp dostop do lokacije med uporabo za shranjevanje rastišč.' }],
    ['expo-image-picker', { photosPermission: 'Dovolite izbor fotografij gob.', cameraPermission: 'Dovolite fotografiranje najdb.' }],
    ['expo-splash-screen', { image: './assets/mushroom-icon.png', resizeMode: 'contain', backgroundColor: '#F7F3E8', imageWidth: 180 }],
  ],
  extra: { eas: { projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? 'REPLACE_WITH_EAS_PROJECT_ID' } },
});
