import {
  AuthFlow,
  Body,
  Button,
  Card,
  deviceTokenStorage,
  FormScreen,
  SessionProvider,
  ThemeProvider,
  Title,
  useDrivaFonts,
  useSession,
  useTheme,
  Welcome,
} from '@driva/ui';
import { formatNigerianPhone } from '@driva/shared';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';
const storage = deviceTokenStorage('driva.refreshToken');

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
  if (status === 'signed_in') return <Home />;
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

function Home() {
  const { user, signOut } = useSession();
  if (!user) return null;
  return (
    <FormScreen footer={<Button title="Sign out" variant="ghost" onPress={() => void signOut()} />}>
      <StatusBar style="auto" />
      <View style={{ height: 24 }} />
      <Title size={28}>Welcome, {user.fullName.split(' ')[0]}</Title>
      <Body muted style={{ marginTop: 6, marginBottom: 18 }}>
        Your account is ready. Booking a driver arrives in the next update.
      </Body>
      <Card>
        <Body bold>{user.fullName}</Body>
        <Body muted>{formatNigerianPhone(user.phone)}</Body>
      </Card>
    </FormScreen>
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
