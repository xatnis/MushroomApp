const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// Expo inlines EXPO_PUBLIC flags into transformed modules. Keep explicit internal
// and ordinary builds in separate JS transform-cache namespaces, including CI.
// This is NOT a weather cache or data-contract change.
config.cacheVersion = `${config.cacheVersion ?? 'mushroomapp'}:koroska-shadow-${process.env.EXPO_PUBLIC_ENABLE_KOROSKA_SHADOW_PREVIEW === '1' ? 'on' : 'off'}`;
module.exports = config;
