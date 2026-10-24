import { ApiError, createApiClient, TrackView } from '@driva/shared';
import { Body, Card, fontFamily, LinkButton, Title, useTheme } from '@driva/ui';
import { useEffect, useMemo, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';

const POLL_MS = 5000;

const STATUS: Record<string, string> = {
  accepted: 'Driver on the way to pickup',
  driver_arrived: 'Driver at pickup',
  in_progress: 'Trip in progress',
  completed: 'Trip complete',
  cancelled: 'Trip cancelled',
};

/** The page behind a share link. Anyone with the link can open it; no sign in. */
export function TrackPage({ apiUrl, token }: { apiUrl: string; token: string }) {
  const { colors } = useTheme();
  const api = useMemo(() => createApiClient({ baseUrl: apiUrl }), [apiUrl]);
  const [trip, setTrip] = useState<TrackView | null>(null);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const load = () =>
      api
        .track(token)
        .then(setTrip)
        .catch((err) => {
          if (err instanceof ApiError && err.status === 404) setGone(true);
        });
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [api, token]);

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.page}>
      <View style={styles.brandRow}>
        <View style={[styles.logo, { backgroundColor: colors.amber }]}>
          <Text style={[styles.logoText, { color: colors.navy }]}>D</Text>
        </View>
        <Text style={[styles.word, { color: colors.ink }]}>Driva trip</Text>
      </View>
      {gone ? (
        <>
          <Title>This link has expired</Title>
          <Body muted style={{ marginTop: 6 }}>
            Tracking links stop working an hour after the trip ends.
          </Body>
        </>
      ) : !trip ? (
        <Body muted>Loading…</Body>
      ) : (
        <>
          <Title>{STATUS[trip.status] ?? trip.status}</Title>
          <Body muted style={{ marginTop: 6, marginBottom: 16 }}>
            {trip.pickupLabel}
            {trip.destinationLabel ? ` to ${trip.destinationLabel}` : ''}
          </Body>
          <Card>
            <Body bold>
              {trip.driverFirstName
                ? `${trip.driverFirstName}, vetted by VeriQuest`
                : 'Driva driver'}
            </Body>
            <Body muted>
              {trip.vehicle.colour ? `${trip.vehicle.colour} ` : ''}
              {trip.vehicle.makeModel} · {trip.vehicle.plateNumber}
            </Body>
          </Card>
          <View style={{ height: 12 }} />
          <Card>
            {trip.location ? (
              <>
                <Body bold>
                  Last seen{' '}
                  {new Date(trip.location.at).toLocaleTimeString('en-NG', {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </Body>
                <Body muted>
                  {trip.location.lat.toFixed(5)}, {trip.location.lng.toFixed(5)}
                </Body>
                <LinkButton
                  title="Open in Google Maps"
                  onPress={() =>
                    void Linking.openURL(
                      `https://www.google.com/maps?q=${trip.location!.lat},${trip.location!.lng}`,
                    )
                  }
                />
              </>
            ) : (
              <Body muted>
                {trip.status === 'completed'
                  ? 'The trip has ended.'
                  : 'Waiting for the driver’s location.'}
              </Body>
            )}
          </Card>
          <Body muted style={{ marginTop: 12, fontSize: 13 }}>
            This page updates every few seconds.
          </Body>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, maxWidth: 520, width: '100%', alignSelf: 'center' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 24 },
  logo: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  logoText: { fontFamily: fontFamily.heading, fontSize: 20 },
  word: { fontFamily: fontFamily.heading, fontSize: 20 },
});
