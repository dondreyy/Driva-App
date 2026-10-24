import {
  ApiError,
  DRIVE_ALONE_TASKS,
  DriveAloneTask,
  MAX_RIDE_HOURS,
  Place,
  QuoteView,
  Vehicle,
} from '@driva/shared';
import {
  Body,
  Button,
  Chips,
  ErrorBanner,
  FormScreen,
  fontFamily,
  LinkButton,
  Title,
  useSession,
  useTheme,
} from '@driva/ui';
import * as Location from 'expo-location';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PlaceSearch } from './PlaceSearch';
import { dayLabels, defaultLaterMinutes, pickupDate, STEP_MINUTES, timeLabel } from './when';

type TripType = 'ride_with_me' | 'drive_alone';

export interface BookingDraft {
  tripType: TripType;
  pickup: Place | null;
  destination: Place | null;
  hours: number;
  task: DriveAloneTask | null;
  carId: string | null;
  later: boolean;
  dayOffset: number;
  minutes: number;
}

export function newDraft(now = new Date()): BookingDraft {
  return {
    tripType: 'ride_with_me',
    pickup: null,
    destination: null,
    hours: 2,
    task: null,
    carId: null,
    later: false,
    dayOffset: 0,
    minutes: defaultLaterMinutes(now),
  };
}

/** The prototype's "Where to?" sheet. */
export function BookScreen({
  draft,
  setDraft,
  cars,
  onAddCar,
  onQuote,
}: {
  draft: BookingDraft;
  setDraft: (update: (d: BookingDraft) => BookingDraft) => void;
  cars: Vehicle[];
  onAddCar: () => void;
  onQuote: (quote: QuoteView) => void;
}) {
  const { api, signOut } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const days = useMemo(() => dayLabels(new Date()), []);
  const set = (patch: Partial<BookingDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const solo = draft.tripType === 'drive_alone';

  async function useMyLocation() {
    setError(null);
    setLocating(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted)
        throw new Error('Allow location access, or search for your pickup point.');
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      set({
        pickup: await api.reverseGeocode({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not find your location.');
    } finally {
      setLocating(false);
    }
  }

  useEffect(() => {
    if (!draft.pickup) void useMyLocation();
    // Only when the screen first opens.
  }, []);

  async function seePrice() {
    setError(null);
    if (!draft.pickup) return setError('Set your pickup point.');
    if (solo && !draft.destination) return setError('Choose where the car is going.');
    if (solo && !draft.task) return setError('Choose what the driver should do.');
    if (!draft.carId) return setError(cars.length ? 'Choose your car.' : 'Add your car first.');
    setBusy(true);
    try {
      onQuote(
        await api.createQuote({
          tripType: draft.tripType,
          pickup: draft.pickup,
          ...(draft.destination ? { destination: draft.destination } : {}),
          ...(solo ? { task: draft.task! } : { hours: draft.hours }),
          ...(draft.later
            ? { pickupAt: pickupDate(new Date(), draft.dayOffset, draft.minutes).toISOString() }
            : {}),
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormScreen
      footer={<Button title="See price" onPress={() => void seePrice()} loading={busy} />}
    >
      <View style={{ height: 16 }} />
      <Title>Where to?</Title>
      <Body muted style={{ marginTop: 4, marginBottom: 14 }}>
        A vetted driver drives your own car.
      </Body>
      <ErrorBanner message={error} />

      <PlaceSearch
        label="Pickup"
        placeholder="Search for your pickup point"
        value={draft.pickup}
        near={draft.pickup}
        onPick={(pickup) => set({ pickup })}
      />
      <LinkButton
        title={locating ? 'Finding you…' : 'Use my current location'}
        disabled={locating}
        onPress={() => void useMyLocation()}
      />

      <TypeCards value={draft.tripType} onChange={(tripType) => set({ tripType })} />

      <PlaceSearch
        label={solo ? 'Destination' : 'Destination (optional)'}
        placeholder="Where are you going?"
        value={draft.destination}
        near={draft.pickup}
        onPick={(destination) => set({ destination })}
      />

      {solo ? (
        <Chips
          label="What should the driver do?"
          options={DRIVE_ALONE_TASKS}
          value={draft.task}
          onChange={(task) => set({ task })}
        />
      ) : (
        <HoursStepper hours={draft.hours} onChange={(hours) => set({ hours })} />
      )}

      {cars.length ? (
        <Chips
          label="Your car"
          options={cars.map((c) => `${c.makeModel} · ${c.plateNumber}`)}
          value={(() => {
            const car = cars.find((c) => c.id === draft.carId);
            return car ? `${car.makeModel} · ${car.plateNumber}` : null;
          })()}
          onChange={(label) =>
            set({ carId: cars.find((c) => `${c.makeModel} · ${c.plateNumber}` === label)!.id })
          }
        />
      ) : (
        <Body bold style={{ fontSize: 13, marginTop: 4 }}>
          Your car
        </Body>
      )}
      <LinkButton title="Add a car" onPress={onAddCar} />

      <Chips
        label="When"
        options={['Now', 'Later'] as const}
        value={draft.later ? 'Later' : 'Now'}
        onChange={(v) => set({ later: v === 'Later' })}
      />
      {draft.later ? (
        <>
          <Chips
            label="Day"
            options={days}
            value={days[draft.dayOffset]!}
            onChange={(d) => set({ dayOffset: days.indexOf(d) })}
          />
          <TimeStepper minutes={draft.minutes} onChange={(minutes) => set({ minutes })} />
        </>
      ) : null}
      <LinkButton title="Sign out" onPress={() => void signOut()} />
    </FormScreen>
  );
}

function TypeCards({ value, onChange }: { value: TripType; onChange: (t: TripType) => void }) {
  const { colors } = useTheme();
  const cards: [TripType, string, string][] = [
    ['ride_with_me', 'Ride with me', 'You sit in the car. Priced by the hour.'],
    ['drive_alone', 'Drive my car alone', 'Driver moves the car. Fixed fare.'],
  ];
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Trip type" style={styles.types}>
      {cards.map(([type, title, sub]) => {
        const on = type === value;
        return (
          <Pressable
            key={type}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={title}
            onPress={() => onChange(type)}
            style={[
              styles.card,
              {
                borderColor: on ? colors.amber : colors.line,
                backgroundColor: on ? colors.amberSoft : colors.surface,
              },
            ]}
          >
            <Text style={[styles.cardTitle, { color: colors.ink }]}>{title}</Text>
            <Text style={[styles.cardSub, { color: colors.muted }]}>{sub}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Stepper({
  label,
  value,
  sub,
  onMinus,
  onPlus,
  minusLabel,
  plusLabel,
}: {
  label: string;
  value: string;
  sub: string;
  onMinus: () => void;
  onPlus: () => void;
  minusLabel: string;
  plusLabel: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={[styles.label, { color: colors.ink }]}>{label}</Text>
      <View style={[styles.stepper, { borderColor: colors.line, backgroundColor: colors.surface }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.cardTitle, { color: colors.ink }]}>{value}</Text>
          <Text style={[styles.cardSub, { color: colors.muted }]}>{sub}</Text>
        </View>
        {[
          ['−', onMinus, minusLabel],
          ['+', onPlus, plusLabel],
        ].map(([sign, press, a11y]) => (
          <Pressable
            key={a11y as string}
            accessibilityRole="button"
            accessibilityLabel={a11y as string}
            onPress={press as () => void}
            style={[styles.stepButton, { borderColor: colors.line }]}
          >
            <Text style={[styles.cardTitle, { color: colors.ink, fontSize: 20 }]}>
              {sign as string}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function HoursStepper({ hours, onChange }: { hours: number; onChange: (h: number) => void }) {
  return (
    <Stepper
      label="How long?"
      value={`${hours} hours`}
      sub="Priced by the hour, 2 hours minimum"
      minusLabel="Fewer hours"
      plusLabel="More hours"
      onMinus={() => onChange(Math.max(2, hours - 1))}
      onPlus={() => onChange(Math.min(MAX_RIDE_HOURS, hours + 1))}
    />
  );
}

function TimeStepper({ minutes, onChange }: { minutes: number; onChange: (m: number) => void }) {
  const last = 24 * 60 - STEP_MINUTES;
  return (
    <Stepper
      label="Pickup time"
      value={timeLabel(minutes)}
      sub="Night trips (9pm to 5am) add a night fee"
      minusLabel="Earlier"
      plusLabel="Later"
      onMinus={() => onChange(Math.max(0, minutes - STEP_MINUTES))}
      onPlus={() => onChange(Math.min(last, minutes + STEP_MINUTES))}
    />
  );
}

const styles = StyleSheet.create({
  types: { flexDirection: 'row', gap: 10, marginVertical: 12 },
  card: { flex: 1, borderWidth: 1.5, borderRadius: 20, padding: 14, gap: 4 },
  cardTitle: { fontFamily: fontFamily.heading, fontSize: 16 },
  cardSub: { fontFamily: fontFamily.body, fontSize: 13, lineHeight: 17 },
  label: { fontSize: 13, fontFamily: fontFamily.bodyBold, marginBottom: 8 },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 20,
    padding: 14,
  },
  stepButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
