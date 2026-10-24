import {
  ApiError,
  BookingView,
  formatNaira,
  PhotoPhase,
  Place,
  TRIP_PHOTO_LABELS,
  TRIP_PHOTO_SHOTS,
  TRIP_PIN_LENGTH,
} from '@driva/shared';
import {
  Body,
  Button,
  Card,
  ErrorBanner,
  Field,
  fontFamily,
  PhotoTile,
  useSession,
  useTheme,
} from '@driva/ui';
import { useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { takePhoto, uploadPhoto } from './photos';

type Shot = (typeof TRIP_PHOTO_SHOTS)[number];

function navigate(to: Place) {
  void Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${to.lat},${to.lng}`);
}

/** The accepted trip, step by step, as in the prototype's driver trip screens. */
export function TripFlow({
  trip,
  onChange,
  onFinished,
}: {
  trip: BookingView;
  onChange: (trip: BookingView) => void;
  onFinished: () => void;
}) {
  const { api } = useSession();
  const { colors } = useTheme();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const solo = trip.tripType === 'drive_alone';

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

  async function photo(phase: PhotoPhase, shot: Shot) {
    setError(null);
    try {
      const p = await takePhoto(false);
      if (!p) return;
      setUploading(`${phase}-${shot}`);
      const ticket = await api.tripPhotoUpload(trip.id, {
        phase,
        shot,
        contentType: p.contentType,
      });
      await uploadPhoto(ticket, p);
      onChange(await api.saveTripPhoto(trip.id, { phase, shot, key: ticket.key }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The photo did not upload.');
    } finally {
      setUploading(null);
    }
  }

  const has = (phase: PhotoPhase) => (shot: Shot) =>
    trip.photos.some((p) => p.phase === phase && p.shot === shot);
  const allPhotos = (phase: PhotoPhase) => TRIP_PHOTO_SHOTS.every(has(phase));

  const photoGrid = (phase: PhotoPhase) => (
    <View style={styles.grid}>
      {TRIP_PHOTO_SHOTS.map((shot) => (
        <View key={shot} style={styles.cell}>
          <PhotoTile
            label={TRIP_PHOTO_LABELS[shot]}
            done={has(phase)(shot)}
            busy={uploading === `${phase}-${shot}`}
            onPress={() => void photo(phase, shot)}
          />
        </View>
      ))}
    </View>
  );

  if (trip.status === 'cancelled') {
    return (
      <View>
        <Text style={[styles.h2, { color: colors.ink }]}>Trip cancelled</Text>
        <Body muted style={{ textAlign: 'center', marginVertical: 12 }}>
          {trip.clientFirstName} cancelled this trip. Stay online for the next request.
        </Body>
        <Button title="Back to requests" onPress={onFinished} />
      </View>
    );
  }

  if (trip.status === 'completed') {
    const pct = (trip.commissionBps ?? 0) / 100;
    return (
      <View>
        <Text style={[styles.h2, { color: colors.ink }]}>Trip complete</Text>
        <Body muted style={{ textAlign: 'center', marginBottom: 14 }}>
          {trip.pickup.label}
          {trip.destination ? ` to ${trip.destination.label}` : ''}
        </Body>
        <Card>
          <Row label="Trip fare" value={formatNaira(trip.totalFareKobo)} />
          <Row label={`Driva fee (${pct}%)`} value={`−${formatNaira(trip.commissionKobo ?? 0)}`} />
          <View style={[styles.divider, { backgroundColor: colors.line }]} />
          <View style={styles.row}>
            <Text style={[styles.h3, { color: colors.ink }]}>You earn</Text>
            <Text
              accessibilityLabel={`You earned ${formatNaira(trip.driverEarningKobo ?? 0)}`}
              style={[styles.earn, { color: colors.ink }]}
            >
              {formatNaira(trip.driverEarningKobo ?? 0)}
            </Text>
          </View>
          <Body muted style={{ fontSize: 13, marginTop: 4 }}>
            Paid to your bank account at the end of the day, once payouts start.
          </Body>
        </Card>
        <View style={{ height: 16 }} />
        <Button title="Back to requests" onPress={onFinished} />
      </View>
    );
  }

  return (
    <View>
      <Text style={[styles.h2, { color: colors.ink }]}>
        {(
          {
            accepted: 'Head to pickup',
            driver_arrived: 'Verify and start',
            in_progress: 'Trip in progress',
          } as Record<string, string>
        )[trip.status] ?? 'Trip'}
      </Text>
      <ErrorBanner message={error} />

      {trip.status === 'accepted' ? (
        <>
          <Card>
            <Text style={[styles.h3, { color: colors.ink }]}>{trip.pickup.label}</Text>
            <Body muted>
              Client: {trip.clientFirstName} · {trip.vehicle.makeModel} · {trip.vehicle.plateNumber}
            </Body>
          </Card>
          <View style={{ height: 12 }} />
          <Button
            title="Navigate to pickup"
            variant="ghost"
            onPress={() => navigate(trip.pickup)}
          />
          <View style={{ height: 10 }} />
          <Button
            title="I have arrived"
            onPress={() => void run(async () => onChange(await api.arrived(trip.id)))}
            loading={busy}
          />
        </>
      ) : null}

      {trip.status === 'driver_arrived' ? (
        <>
          <Card>
            <Text style={[styles.h3, { color: colors.ink }]}>Enter the client PIN</Text>
            <Body muted style={{ marginBottom: 10 }}>
              Ask {trip.clientFirstName} for the {TRIP_PIN_LENGTH} digit PIN.
            </Body>
            {trip.pinVerified ? (
              <Body bold style={{ color: colors.ok }}>
                {'✓'} PIN confirmed
              </Body>
            ) : (
              <>
                <Field
                  label="Trip PIN"
                  keyboardType="number-pad"
                  maxLength={TRIP_PIN_LENGTH}
                  value={pin}
                  onChangeText={(t) => setPin(t.replace(/\D/g, ''))}
                />
                <Button
                  title="Check PIN"
                  variant="dark"
                  disabled={pin.length !== TRIP_PIN_LENGTH}
                  loading={busy}
                  onPress={() => void run(async () => onChange(await api.checkPin(trip.id, pin)))}
                />
              </>
            )}
          </Card>
          {solo ? (
            <>
              <View style={{ height: 12 }} />
              <Card>
                <Text style={[styles.h3, { color: colors.ink }]}>Photograph the car</Text>
                <Body muted style={{ marginBottom: 10 }}>
                  Five photos before you leave. The client sees them.
                </Body>
                {photoGrid('before')}
              </Card>
            </>
          ) : null}
          <View style={{ height: 12 }} />
          <Button
            title="Start trip"
            disabled={!trip.pinVerified || (solo && !allPhotos('before'))}
            loading={busy}
            onPress={() => void run(async () => onChange(await api.startTrip(trip.id)))}
          />
        </>
      ) : null}

      {trip.status === 'in_progress' ? (
        <>
          <Card>
            <Text style={[styles.h3, { color: colors.ink }]}>
              {trip.destination?.label ?? `With ${trip.clientFirstName}`}
            </Text>
            <Body muted>
              {solo
                ? 'Stay on the agreed route. The client is tracking the car.'
                : `${trip.hours} hours, client rides along.`}
            </Body>
          </Card>
          {trip.destination ? (
            <>
              <View style={{ height: 12 }} />
              <Button
                title="Navigate"
                variant="ghost"
                onPress={() => navigate(trip.destination!)}
              />
            </>
          ) : null}
          {solo ? (
            <>
              <View style={{ height: 12 }} />
              <Card>
                <Text style={[styles.h3, { color: colors.ink }]}>Return photos</Text>
                <Body muted style={{ marginBottom: 10 }}>
                  Five photos when you hand the car back.
                </Body>
                {photoGrid('after')}
              </Card>
            </>
          ) : null}
          <View style={{ height: 12 }} />
          <Button
            title="End trip"
            disabled={solo && !allPhotos('after')}
            loading={busy}
            onPress={() => void run(async () => onChange(await api.endTrip(trip.id)))}
          />
        </>
      ) : null}
      <Body muted style={{ textAlign: 'center', marginTop: 12, fontSize: 13 }}>
        Fare locked at {formatNaira(trip.totalFareKobo)}
      </Body>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Body muted>{label}</Body>
      <Body>{value}</Body>
    </View>
  );
}

const styles = StyleSheet.create({
  h2: { fontFamily: fontFamily.heading, fontSize: 22, textAlign: 'center', marginBottom: 12 },
  h3: { fontFamily: fontFamily.heading, fontSize: 17, marginBottom: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 3,
  },
  divider: { height: 1, marginVertical: 10 },
  earn: { fontFamily: fontFamily.heading, fontSize: 30 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cell: { width: '31%' },
});
