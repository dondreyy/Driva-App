import {
  ApiError,
  BookingView,
  formatNaira,
  LatLng,
  SOCKET_EVENTS,
  TRIP_PHOTO_LABELS,
  TripLocation,
} from '@driva/shared';
import {
  Body,
  Button,
  Card,
  fontFamily,
  FormScreen,
  LinkButton,
  StepList,
  Title,
  useLiveEvent,
  useSession,
  useTheme,
} from '@driva/ui';
import { useCallback, useEffect, useState } from 'react';
import { Image, Platform, Share, StyleSheet, Text, View } from 'react-native';
import { whenLabel } from './when';

/** Live events do the work; this slower check covers a dropped connection. */
const FALLBACK_POLL_MS = 15_000;
const OPEN = ['requested', 'matching', 'accepted', 'driver_arrived', 'in_progress'];

function kmBetween(a: LatLng, b: LatLng): number {
  const R = 6371;
  const r = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(r(b.lat - a.lat) / 2) ** 2 +
    Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** From "Request a driver" to the receipt. */
export function TripScreen({ initial, onDone }: { initial: BookingView; onDone: () => void }) {
  const { api } = useSession();
  const [booking, setBooking] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setBooking(await api.getBooking(initial.id));
    } catch {
      // Keep showing the last known state; the next update tries again.
    }
  }, [api, initial.id]);

  useLiveEvent<{ bookingId: string }>(SOCKET_EVENTS.booking, (e) => {
    if (e.bookingId === initial.id) void refresh();
  });
  useLiveEvent<{ bookingId: string } & TripLocation>(SOCKET_EVENTS.location, (e) => {
    if (e.bookingId === initial.id)
      setBooking((b) => ({ ...b, driverLocation: { lat: e.lat, lng: e.lng, at: e.at } }));
  });

  useEffect(() => {
    if (!OPEN.includes(booking.status)) return;
    const timer = setInterval(() => void refresh(), FALLBACK_POLL_MS);
    return () => clearInterval(timer);
  }, [booking.status, refresh]);

  async function run(work: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await work();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  const cancel = () => run(async () => setBooking(await api.cancelBooking(booking.id)));

  const share = () =>
    run(async () => {
      const { url } = await api.shareTrip(booking.id);
      setShareUrl(url);
      if (Platform.OS !== 'web') {
        await Share.share({ message: `Follow my Driva trip live: ${url}` });
      }
    });

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

  if (booking.status === 'completed') return <Receipt booking={booking} onDone={onDone} />;

  // On the way, arrived, or on the trip.
  const driver = booking.driver!;
  const solo = booking.tripType === 'drive_alone';
  const stage =
    ({ accepted: 0, driver_arrived: 1, in_progress: 2 } as Record<string, number>)[
      booking.status
    ] ?? 0;
  const km = booking.driverLocation ? kmBetween(booking.driverLocation, booking.pickup) : null;
  const heading = [
    `${driver.firstName} is on the way`,
    `${driver.firstName} has arrived`,
    solo
      ? `${driver.firstName} is driving your car`
      : booking.destination
        ? `On the way to ${booking.destination.label}`
        : 'On your trip',
  ][stage]!;
  const sub = [
    km === null
      ? 'Heading to your pickup.'
      : km < 0.2
        ? 'Almost at your pickup.'
        : `About ${km.toFixed(1)} km from your pickup.`,
    'Check their face matches the photo. Then give them the PIN.',
    solo
      ? 'Follow the car live, or share the link with whoever receives it.'
      : 'Your driver stays on the agreed route.',
  ][stage]!;
  const before = booking.photos.filter((p) => p.phase === 'before');

  return (
    <FormScreen
      footer={
        <View>
          <Button title="Share trip" variant="dark" onPress={() => void share()} loading={busy} />
          {booking.status === 'accepted' ? (
            <LinkButton title="Cancel trip" onPress={() => void cancel()} disabled={busy} />
          ) : null}
        </View>
      }
    >
      <View style={{ height: 16 }} />
      <Timeline stage={stage} />
      <Title>{heading}</Title>
      <Body muted style={{ marginTop: 6, marginBottom: 16 }}>
        {sub}
      </Body>
      {error ? <Body style={{ marginBottom: 12 }}>{error}</Body> : null}
      <DriverCard booking={booking} />
      {booking.tripPin ? <PinBox pin={booking.tripPin} /> : null}
      {shareUrl ? (
        <Card>
          <Body bold style={{ fontSize: 13 }}>
            Live tracking link
          </Body>
          <Text
            selectable
            accessibilityLabel="Share link"
            style={{ fontFamily: fontFamily.body, fontSize: 13, marginTop: 4 }}
          >
            {shareUrl}
          </Text>
        </Card>
      ) : null}
      {solo && before.length ? (
        <View style={{ marginTop: 12 }}>
          <Body bold style={{ fontSize: 13, marginBottom: 8 }}>
            Handover photos ({before.length} of 5)
          </Body>
          <PhotoStrip photos={before} />
        </View>
      ) : null}
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

function Timeline({ stage }: { stage: number }) {
  const { colors } = useTheme();
  const labels = ['On the way', 'Arrived', 'On trip', 'Done'];
  return (
    <View accessibilityLabel={`Trip progress: ${labels[stage]}`} style={styles.timeline}>
      {labels.map((label, i) => (
        <View key={label} style={{ flex: 1, gap: 6 }}>
          <View
            style={[styles.bar, { backgroundColor: i <= stage ? colors.amber : colors.soft }]}
          />
          <Text style={[styles.tlText, { color: i <= stage ? colors.ink : colors.muted }]}>
            {label}
          </Text>
        </View>
      ))}
    </View>
  );
}

function PinBox({ pin }: { pin: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.pinBox, { backgroundColor: colors.navy }]}>
      <Text style={styles.pinTitle}>Your trip PIN</Text>
      <View
        accessibilityLabel={`Your trip PIN is ${pin.split('').join(' ')}`}
        style={styles.digits}
      >
        {pin.split('').map((d, i) => (
          <Text
            key={i}
            style={[styles.digit, { backgroundColor: colors.amber, color: colors.navy }]}
          >
            {d}
          </Text>
        ))}
      </View>
      <Text style={styles.pinNote}>The trip cannot start until your driver enters it.</Text>
    </View>
  );
}

function PhotoStrip({ photos }: { photos: BookingView['photos'] }) {
  return (
    <View style={styles.photos}>
      {photos.map((p) => (
        <View key={`${p.phase}-${p.shot}`} style={{ width: '31%' }}>
          <Image
            source={{ uri: p.url }}
            style={styles.photo}
            accessibilityLabel={`${TRIP_PHOTO_LABELS[p.shot]} photo`}
          />
          <Text style={styles.photoLabel}>{TRIP_PHOTO_LABELS[p.shot]}</Text>
        </View>
      ))}
    </View>
  );
}

function Receipt({ booking, onDone }: { booking: BookingView; onDone: () => void }) {
  const { colors } = useTheme();
  const solo = booking.tripType === 'drive_alone';
  const after = booking.photos.filter((p) => p.phase === 'after');
  return (
    <FormScreen footer={<Button title="Done" onPress={onDone} />}>
      <View style={{ alignItems: 'center', marginTop: 24 }}>
        <View style={[styles.tick, { backgroundColor: colors.okBg }]}>
          <Text style={{ color: colors.ok, fontSize: 34, fontFamily: fontFamily.bodyBold }}>
            {'✓'}
          </Text>
        </View>
        <Title size={28}>Trip complete</Title>
        <Body muted style={{ marginTop: 4, marginBottom: 16, textAlign: 'center' }}>
          {booking.pickup.label}
          {booking.destination ? ` to ${booking.destination.label}` : ''}
        </Body>
      </View>
      <Card>
        <Row label="Trip" value={solo ? 'Drive my car alone' : 'Ride with me'} />
        <Row label="Driver" value={booking.driver?.firstName ?? ''} />
        {solo ? (
          <Row label="Return photos" value={`${after.length} of 5`} />
        ) : (
          <Row label="Time" value={`${booking.hours} hours`} />
        )}
        <View style={[styles.divider, { backgroundColor: colors.line }]} />
        <View style={styles.row}>
          <Text style={[styles.total, { color: colors.ink }]}>Total</Text>
          <Text
            accessibilityLabel={`Total ${formatNaira(booking.totalFareKobo)}`}
            style={[styles.fare, { color: colors.ink }]}
          >
            {formatNaira(booking.totalFareKobo)}
          </Text>
        </View>
        <Body muted style={{ fontSize: 13, marginTop: 4 }}>
          The price agreed before the trip. Payment, ratings and tips come in the next updates.
        </Body>
      </Card>
      {solo && after.length ? (
        <View style={{ marginTop: 12 }}>
          <Body bold style={{ fontSize: 13, marginBottom: 8 }}>
            Your car when it came back
          </Body>
          <PhotoStrip photos={after} />
        </View>
      ) : null}
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
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 4,
  },
  timeline: { flexDirection: 'row', gap: 6, marginBottom: 16 },
  bar: { height: 5, borderRadius: 5 },
  tlText: { fontFamily: fontFamily.bodyBold, fontSize: 11 },
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
  pinBox: { borderRadius: 20, padding: 16, marginTop: 12, alignItems: 'center', gap: 10 },
  pinTitle: { fontFamily: fontFamily.heading, fontSize: 16, color: '#FFFFFF' },
  digits: { flexDirection: 'row', gap: 10 },
  digit: {
    width: 52,
    height: 60,
    borderRadius: 14,
    textAlign: 'center',
    lineHeight: 60,
    fontFamily: fontFamily.heading,
    fontSize: 30,
    overflow: 'hidden',
  },
  pinNote: { fontFamily: fontFamily.body, fontSize: 13, color: '#C5D2E6', textAlign: 'center' },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: 10 },
  photoLabel: { fontFamily: fontFamily.bodyBold, fontSize: 11, marginTop: 2 },
  tick: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  divider: { height: 1, marginVertical: 10 },
  total: { fontFamily: fontFamily.heading, fontSize: 17 },
  fare: { fontFamily: fontFamily.heading, fontSize: 30 },
});
