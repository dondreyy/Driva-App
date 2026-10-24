import {
  ApiError,
  BookingView,
  DriverOffer,
  formatNaira,
  LOCATION_INTERVAL_SECONDS,
  ShiftView,
} from '@driva/shared';
import {
  Body,
  Button,
  Card,
  ErrorBanner,
  fontFamily,
  LinkButton,
  useSession,
  useTheme,
} from '@driva/ui';
import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { takePhoto, uploadPhoto } from './photos';

const OFFER_POLL_MS = 2000;

async function currentPosition() {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted)
    throw new Error('Allow location access so Driva can send you nearby trips.');
  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  const heading = pos.coords.heading;
  return {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    ...(heading != null && heading >= 0 ? { heading: Math.round(heading) % 360 } : {}),
  };
}

/** The approved driver's home: go online, receive a request, accept or decline it. */
export function Dashboard() {
  const { api, user, signOut } = useSession();
  const { colors } = useTheme();
  const [shift, setShift] = useState<ShiftView | null>(null);
  const [offer, setOffer] = useState<DriverOffer | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [trip, setTrip] = useState<BookingView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const answered = useRef(false);

  const load = useCallback(async () => {
    const s = await api.shift();
    setShift(s);
    setTrip(s.activeBookingId ? await api.getBooking(s.activeBookingId) : null);
  }, [api]);

  useEffect(() => {
    load().catch(() => setError('Could not load your status. Check your connection.'));
  }, [load]);

  const online = !!shift?.online;

  // While online: send the location every few seconds, and check for a request.
  useEffect(() => {
    if (!online || trip) return;
    const sendLocation = setInterval(() => {
      currentPosition()
        .then((at) => api.sendLocation(at))
        .catch(() => undefined);
    }, LOCATION_INTERVAL_SECONDS * 1000);
    const poll = setInterval(() => {
      api
        .currentOffer()
        .then(({ offer: next }) => {
          setOffer((prev) => {
            if (prev && !next && !answered.current)
              setNotice('That request went to another driver.');
            if (next && next.id !== prev?.id) {
              answered.current = false;
              setNotice(null);
              setSecondsLeft(next.secondsLeft);
            }
            return next;
          });
        })
        .catch(() => undefined);
    }, OFFER_POLL_MS);
    return () => {
      clearInterval(sendLocation);
      clearInterval(poll);
    };
  }, [online, trip, api]);

  // Countdown from the server's seconds, ticking on this phone.
  useEffect(() => {
    if (!offer) return;
    const timer = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [offer]);

  async function run(work: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await work();
    } catch (err) {
      setError(
        err instanceof ApiError || err instanceof Error ? err.message : 'Something went wrong.',
      );
    } finally {
      setBusy(false);
    }
  }

  const goOnline = () =>
    run(async () => {
      const photo = await takePhoto(true);
      if (!photo) return;
      const at = await currentPosition();
      const ticket = await api.shiftSelfieUpload({ contentType: photo.contentType });
      await uploadPhoto(ticket, photo);
      setShift(await api.startShift({ selfieKey: ticket.key, lat: at.lat, lng: at.lng }));
    });

  const goOffline = () =>
    run(async () => {
      setShift(await api.endShift());
      setOffer(null);
    });

  const accept = (o: DriverOffer) =>
    run(async () => {
      answered.current = true;
      try {
        setTrip(await api.acceptOffer(o.id));
      } finally {
        setOffer(null);
      }
    });

  const decline = (o: DriverOffer) =>
    run(async () => {
      answered.current = true;
      setOffer(null);
      await api.declineOffer(o.id);
      setNotice('Request declined. Stay online for the next one.');
    });

  return (
    <View style={[styles.fill, { backgroundColor: colors.bg }]}>
      <SafeAreaView edges={['top']} style={[styles.top, { backgroundColor: colors.navy }]}>
        <View style={styles.row}>
          <Text style={styles.brand}>Driva</Text>
          {shift?.canGoOnline ? (
            <Text
              accessibilityRole="switch"
              accessibilityState={{ checked: online }}
              accessibilityLabel={online ? 'Online' : 'Offline'}
              onPress={() => void (online ? goOffline() : goOnline())}
              style={[
                styles.toggle,
                {
                  backgroundColor: online ? colors.amber : 'rgba(255,255,255,0.14)',
                  color: online ? colors.navy : '#FFFFFF',
                },
              ]}
            >
              {online ? 'Online' : 'Offline'}
            </Text>
          ) : null}
        </View>
        <Text style={styles.hello}>Hello, {user?.fullName.split(' ')[0]}</Text>
      </SafeAreaView>

      <ScrollView contentContainerStyle={styles.body}>
        <ErrorBanner message={error} />
        {trip ? (
          <AcceptedTrip trip={trip} />
        ) : offer ? (
          <RequestCard
            offer={offer}
            secondsLeft={secondsLeft}
            busy={busy}
            onAccept={() => void accept(offer)}
            onDecline={() => void decline(offer)}
          />
        ) : (
          <View style={styles.empty}>
            <Text style={[styles.h2, { color: colors.ink }]}>
              {!shift
                ? ''
                : !shift.canGoOnline
                  ? 'You cannot go online'
                  : online
                    ? 'Looking for trips'
                    : 'You are offline'}
            </Text>
            <Body muted style={{ textAlign: 'center', marginTop: 6, marginBottom: 18 }}>
              {!shift
                ? ''
                : !shift.canGoOnline
                  ? 'Your vetting is not current. VeriQuest will contact you about your re-check.'
                  : online
                    ? (notice ?? 'New requests near you appear here.')
                    : 'Take a quick selfie to start your shift and receive trip requests.'}
            </Body>
            {shift?.canGoOnline && !online ? (
              <Button title="Go online" onPress={() => void goOnline()} loading={busy} />
            ) : null}
          </View>
        )}
        {!online ? <LinkButton title="Sign out" onPress={() => void signOut()} /> : null}
      </ScrollView>
    </View>
  );
}

function RequestCard({
  offer,
  secondsLeft,
  busy,
  onAccept,
  onDecline,
}: {
  offer: DriverOffer;
  secondsLeft: number;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const { colors } = useTheme();
  const solo = offer.tripType === 'drive_alone';
  const pct = offer.commissionBps / 100;
  return (
    <Card>
      <View style={styles.row}>
        <View>
          <Text style={[styles.tag, { backgroundColor: colors.soft, color: colors.ink }]}>
            {solo ? 'Drive my car alone' : 'Ride with me'}
          </Text>
          <Body muted style={{ fontSize: 13, marginTop: 6 }}>
            {offer.pickupAt
              ? new Date(offer.pickupAt).toLocaleString('en-NG', {
                  weekday: 'short',
                  hour: 'numeric',
                  minute: '2-digit',
                })
              : 'Now'}{' '}
            · {offer.kmToPickup} km from you
          </Body>
        </View>
        <View
          accessibilityLabel={`${secondsLeft} seconds left`}
          style={[styles.countdown, { borderColor: colors.amber }]}
        >
          <Text style={[styles.count, { color: colors.ink }]}>{secondsLeft}</Text>
        </View>
      </View>
      <Text style={[styles.route, { color: colors.ink }]}>
        {offer.pickup.label}
        {offer.destination ? ` to ${offer.destination.label}` : ''}
      </Text>
      <Body muted style={{ fontSize: 13 }}>
        {solo
          ? `${offer.distanceKm} km, ${offer.task?.toLowerCase()}`
          : `${offer.hours} hours, client rides along`}
        {offer.isNight ? ' · night trip' : ''}
      </Body>
      <View style={[styles.divider, { backgroundColor: colors.line }]} />
      <View style={styles.row}>
        <Body muted>Trip fare</Body>
        <Body>{formatNaira(offer.totalFareKobo)}</Body>
      </View>
      <View style={styles.row}>
        <Body muted>Driva fee ({pct}%)</Body>
        <Body>{`−${formatNaira(offer.commissionKobo)}`}</Body>
      </View>
      <View style={styles.row}>
        <Text style={[styles.h2, { color: colors.ink, fontSize: 17 }]}>You earn</Text>
        <Text
          accessibilityLabel={`You earn ${formatNaira(offer.driverEarningKobo)}`}
          style={[styles.earn, { color: colors.ink }]}
        >
          {formatNaira(offer.driverEarningKobo)}
        </Text>
      </View>
      <View style={[styles.row, { marginTop: 14, gap: 10 }]}>
        <View style={{ flex: 1 }}>
          <Button title="Decline" variant="ghost" onPress={onDecline} disabled={busy} />
        </View>
        <View style={{ flex: 2 }}>
          <Button
            title="Accept trip"
            onPress={onAccept}
            loading={busy}
            disabled={secondsLeft === 0}
          />
        </View>
      </View>
    </Card>
  );
}

function AcceptedTrip({ trip }: { trip: BookingView }) {
  const { colors } = useTheme();
  return (
    <View>
      <Text style={[styles.h2, { color: colors.ink, marginBottom: 6 }]}>Trip accepted</Text>
      <Body muted style={{ marginBottom: 14 }}>
        Head to the pickup. Arriving, the PIN and the trip itself come in the next update.
      </Body>
      <Card>
        <View style={styles.row}>
          <Body muted>Client</Body>
          <Body>{trip.clientFirstName}</Body>
        </View>
        <View style={styles.row}>
          <Body muted>Pickup</Body>
          <Body>{trip.pickup.label}</Body>
        </View>
        {trip.destination ? (
          <View style={styles.row}>
            <Body muted>Destination</Body>
            <Body>{trip.destination.label}</Body>
          </View>
        ) : null}
        <View style={styles.row}>
          <Body muted>Car</Body>
          <Body>{`${trip.vehicle.makeModel} · ${trip.vehicle.plateNumber}`}</Body>
        </View>
        <View style={styles.row}>
          <Body muted>Fare, locked</Body>
          <Body>{formatNaira(trip.totalFareKobo)}</Body>
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  top: { paddingHorizontal: 20, paddingBottom: 18, paddingTop: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 3,
  },
  brand: { fontFamily: fontFamily.heading, fontSize: 22, color: '#FFFFFF' },
  hello: { fontFamily: fontFamily.body, fontSize: 15, color: '#C5D2E6', marginTop: 10 },
  toggle: {
    fontFamily: fontFamily.bodyBold,
    fontSize: 14,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
    overflow: 'hidden',
  },
  body: { padding: 20 },
  empty: { alignItems: 'stretch', paddingVertical: 36 },
  h2: { fontFamily: fontFamily.heading, fontSize: 22, textAlign: 'center' },
  tag: {
    fontFamily: fontFamily.bodyBold,
    fontSize: 12,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 3,
    overflow: 'hidden',
    alignSelf: 'flex-start',
  },
  countdown: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  count: { fontFamily: fontFamily.heading, fontSize: 18 },
  route: { fontFamily: fontFamily.heading, fontSize: 17, marginTop: 14 },
  divider: { height: 1, marginVertical: 12 },
  earn: { fontFamily: fontFamily.heading, fontSize: 30 },
});
