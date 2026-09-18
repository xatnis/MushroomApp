import 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SQLiteProvider } from 'expo-sqlite';
import { AppProvider } from './src/state/AppContext';
import { AppNavigator } from './src/navigation/AppNavigator';
import { migrateDatabase } from './src/storage/database';
import { colors } from './src/theme';

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
      <SQLiteProvider databaseName="mushroomapp-v1.db" onInit={migrateDatabase}>
        <AppProvider><StatusBar style="dark" /><AppNavigator /></AppProvider>
      </SQLiteProvider>
    </GestureHandlerRootView>
  );
}
