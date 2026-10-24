import { ApiError, BookingView, formatNaira } from '@driva/shared';
import {
  Body,
  Button,
  Card,
  fontFamily,
  FormScreen,
  StepList,
  Title,
  useSession,
  useTheme,
} from '@driva/ui';
import { useCallback, useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { whenLabel } from './when';

const POLL_MS = 3000;

/** After "Request a driver": finding a driver, then who is coming. */
export function TripScreen({ initial, onDone }: { initial: BookingView; onDone: () => void }) {
  const { api } = useSession();
  const [booking, setBooking] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setBooking(await api.getBooking(booking.id));
    } catch {
      // Keep showing the last known state; the next poll tries again.
    }
  }, [api, booking.id]);

  // Polls until the trip has a driver or ends. Live updates arrive with trip tracking in Step 6.
  useEffect(() => {
    if (!['requested', 'matching', 'accepted'].includes(booking.status)) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [booking.status, refresh]);

  async function cancel() {
    setError(null);
    setBusy(true);
    try {
      setBooking(await api.cancelBooking(booking.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  const scheduledLater =
    booking.status === 'requested' &&
    booking.pickupAt &&
    Date.parse(booking.pickupAt) - Date.now() > 30 * 60_000;

  if (booking.status === 'cancelled' || booking.status === 'no_driver') {
    const none = booking.status === 'no_driver';
    return (
      <FormScreen footer={<Button title={none ? 'Try again' : 'Book a trip'} onPress={onDone} />}>
        <View style={{ height: 24 }} />
        <Title>{none ? 'No driver is free right now' : 'Trip cancelled'}</Title>
        <Body muted style={{ marginTop: 6 }}>
          {none
            ? 'Every nearby driver was busy. Try again in a few minutes. You have not been charged.'
            : 'You have not been charged.'}
        </Body>
      </FormScreen>
    );
  }

  if (booking.status === 'requested' || booking.status === 'matching') {
    return (
      <FormScreen
        footer={
          <Button
            title="Cancel request"
            variant="ghost"
            onPress={() => void cancel()}
            loading={busy}
          />
        }
      >
        <View style={{ height: 24 }} />
        <Title>{scheduledLater ? 'Trip booked' : 'Finding your driver'}</Title>
        <Body muted style={{ marginTop: 6, marginBottom: 20 }}>
          {scheduledLater
            ? `Pickup ${whenLabel(booking.pickupAt)}. We start finding your driver 30 minutes before.`
            : `${booking.pickup.label}${booking.destination ? ` to ${booking.destination.label}` : ''}`}
        </Body>
        {error ? <Body style={{ marginBottom: 12 }}>{error}</Body> : null}
        {scheduledLater ? null : (
          <StepList
            steps={[
              {
                label: 'Checking drivers near your pickup',
                state: booking.status === 'matching' ? 'done' : 'now',
              },
              {
                label: 'Confirming VeriQuest vetting',
                state: booking.status === 'matching' ? 'now' : 'todo',
              },
              { label: 'Matching your car and trip', state: 'todo' },
            ]}
          />
        )}
        <View style={{ height: 12 }} />
        <Card>
          <Row label="Price" value={formatNaira(booking.totalFareKobo)} />
          <Row
            label="Car"
            value={`${booking.vehicle.makeModel} · ${booking.vehicle.plateNumber}`}
          />
        </Card>
      </FormScreen>
    );
  }

  // Accepted, or later stages that Step 6 builds out.
  const driver = booking.driver!;
  return (
    <FormScreen
      footer={
        booking.status === 'accepted' ? (
          <Button
            title="Cancel trip"
            variant="ghost"
            onPress={() => void cancel()}
            loading={busy}
          />
        ) : undefined
      }
    >
      <View style={{ height: 24 }} />
      <Title>{`${driver.firstName} is on the way`}</Title>
      <Body muted style={{ marginTop: 6, marginBottom: 16 }}>
        Live tracking, the trip PIN and calls through Driva arrive in the next update.
      </Body>
      {error ? <Body style={{ marginBottom: 12 }}>{error}</Body> : null}
      <DriverCard booking={booking} />
      <View style={{ height: 12 }} />
      <Card>
        <Row label="Price, fixed" value={formatNaira(booking.totalFareKobo)} />
        <Row label="Pickup" value={booking.pickup.label} />
        {booking.destination ? <Row label="Destination" value={booking.destination.label} /> : null}
        <Row label="Car" value={`${booking.vehicle.makeModel} · ${booking.vehicle.plateNumber}`} />
      </Card>
    </FormScreen>
  );
}

function DriverCard({ booking }: { booking: BookingView }) {
  const { colors } = useTheme();
  const d = booking.driver!;
  return (
    <Card>
      <View style={styles.driver}>
        {d.photoUrl ? (
          <Image
            source={{ uri: d.photoUrl }}
            style={styles.avatar}
            accessibilityLabel={`Photo of ${d.firstName}`}
          />
        ) : (
          <View style={[styles.avatar, { backgroundColor: colors.amber }]}>
            <Text style={[styles.initial, { color: colors.navy }]}>{d.firstName[0]}</Text>
          </View>
        )}
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={[styles.name, { color: colors.ink }]}>{d.firstName}</Text>
          <Text style={[styles.small, { color: colors.muted }]}>
            {d.ratingAvg
              ? `★ ${d.ratingAvg.toFixed(1)} · ${d.ratingCount} trips`
              : 'New Driva driver'}
          </Text>
          <Text style={[styles.badge, { backgroundColor: colors.okBg, color: colors.ok }]}>
            {'✓'} Vetted by {d.vettedBy}
          </Text>
        </View>
      </View>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Body muted>{label}</Body>
      <Body style={{ flexShrink: 1, textAlign: 'right' }}>{value}</Body>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 4 },
  driver: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  initial: { fontFamily: fontFamily.heading, fontSize: 24 },
  name: { fontFamily: fontFamily.heading, fontSize: 18 },
  small: { fontFamily: fontFamily.body, fontSize: 13 },
  badge: {
    alignSelf: 'flex-start',
    fontFamily: fontFamily.bodyBold,
    fontSize: 12,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    overflow: 'hidden',
  },
});
