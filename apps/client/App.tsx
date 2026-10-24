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
import { ActivityIndicator, Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Booking } from './src/Booking';
import { TrackPage } from './src/TrackPage';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';
const storage = deviceTokenStorage('driva.refreshToken');

/** On the web, /track/<token> is the public page behind a share link. */
const trackToken =
  Platform.OS === 'web'
    ? (globalThis as { location?: Location }).location?.pathname.match(/^\/track\/([\w-]+)$/)?.[1]
    : undefined;

export default function App() {
  const fontsReady = useDrivaFonts();
  if (trackToken) {
    return (
      <SafeAreaProvider>
        <ThemeProvider>
          {fontsReady ? <TrackPage apiUrl={API_URL} token={trackToken} /> : <Loading />}
        </ThemeProvider>
      </SafeAreaProvider>
    );
  }
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
  if (status === 'signed_in') return <Booking />;
  if (signingIn) return <AuthFlow app="client" onBack={() => setSigningIn(false)} />;
  return (
    <>
      <StatusBar style="light" />
      <Welcome
        brandName="Driva"
        title="Your car. A driver you can trust."
        body="Every driver is physically verified by VeriQuest, a background check and verification company, before their first ride."
        trust={['Physically verified', 'Trip PIN', 'Photo records']}
      >
        <Button title="Get started" onPress={() => setSigningIn(true)} />
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
