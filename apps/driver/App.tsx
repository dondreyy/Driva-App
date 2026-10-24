import {
  AuthFlow,
  Button,
  deviceTokenStorage,
  SessionProvider,
  ThemeProvider,
  useDrivaFonts,
  useSession,
  useTheme,
  Welcome,
} from '@driva/ui';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DriverHome } from './src/DriverHome';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';
const storage = deviceTokenStorage('driva-driver.refreshToken');

export default function App() {
  const fontsReady = useDrivaFonts();
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <SessionProvider baseUrl={API_URL} storage={storage}>
          {fontsReady ? <Root /> : <Loading />}
        </SessionProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function Root() {
  const { status } = useSession();
  const [signingIn, setSigningIn] = useState(false);

  if (status === 'loading') return <Loading />;
  if (status === 'signed_in') return <DriverHome />;
  if (signingIn) return <AuthFlow app="driver" onBack={() => setSigningIn(false)} />;
  return (
    <>
      <StatusBar style="light" />
      <Welcome
        brandName="Driva Driver"
        title="Drive with Driva."
        body="Drive people's own cars across the city. Every Driva driver is verified in person by VeriQuest before their first trip."
        trust={['Verified in person', 'Paid daily', 'Trip PIN']}
      >
        <Button title="Sign in or apply" onPress={() => setSigningIn(true)} />
      </Welcome>
    </>
  );
}

function Loading() {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.navy,
      }}
    >
      <ActivityIndicator color={colors.amber} size="large" />
    </View>
  );
}
