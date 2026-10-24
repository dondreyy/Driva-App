import { DriverApplication } from '@driva/shared';
import { Body, Button, FormScreen, Title, useSession, useTheme } from '@driva/ui';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Dashboard } from './Dashboard';
import { Registration } from './Registration';
import { VettingStatus } from './VettingStatus';

/** Registration until the application is sent, then the vetting progress. */
export function DriverHome() {
  const { api } = useSession();
  const { colors } = useTheme();
  const [application, setApplication] = useState<DriverApplication | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setApplication(await api.driverApplication());
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setRefreshing(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed && !application) {
    return (
      <FormScreen footer={<Button title="Try again" onPress={() => void load()} />}>
        <Title>No connection</Title>
        <Body muted>We could not load your application. Check your connection.</Body>
      </FormScreen>
    );
  }
  if (!application) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.bg,
        }}
      >
        <ActivityIndicator color={colors.amber} size="large" />
      </View>
    );
  }
  if (application.status === 'not_started' || application.status === 'applied') {
    return <Registration application={application} onChange={setApplication} />;
  }
  if (application.status === 'approved') return <Dashboard />;
  return (
    <VettingStatus
      application={application}
      onRefresh={() => void load()}
      refreshing={refreshing}
    />
  );
}
