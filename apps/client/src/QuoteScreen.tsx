import { formatNaira, QuoteView, Vehicle } from '@driva/shared';
import { Body, Button, Card, fontFamily, FormHeader, FormScreen, useTheme } from '@driva/ui';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { whenLabel } from './when';

/** The prototype's quote sheet: one fixed price and what it is made of. */
export function QuoteScreen({
  quote,
  car,
  onBack,
}: {
  quote: QuoteView;
  car: Vehicle | null;
  onBack: () => void;
}) {
  const { colors } = useTheme();
  const solo = quote.tripType === 'drive_alone';
  const [expired, setExpired] = useState(() => Date.parse(quote.expiresAt) <= Date.now());

  useEffect(() => {
    const ms = Date.parse(quote.expiresAt) - Date.now();
    if (ms <= 0) return;
    const timer = setTimeout(() => setExpired(true), ms);
    return () => clearTimeout(timer);
  }, [quote.expiresAt]);

  const row = (label: string, value: string) => (
    <View style={styles.row} key={label}>
      <Body muted>{label}</Body>
      <Body>{value}</Body>
    </View>
  );

  return (
    <FormScreen
      header={<FormHeader onBack={onBack} />}
      footer={
        <View>
          <Button
            title={expired ? 'Price expired: go back to refresh' : 'Request a driver'}
            onPress={() => undefined}
            disabled
          />
          <Body muted style={{ textAlign: 'center', marginTop: 8, fontSize: 13 }}>
            Requesting a driver opens in the next update.
          </Body>
        </View>
      }
    >
      <View style={styles.row}>
        <Text style={[styles.tag, { backgroundColor: colors.soft, color: colors.ink }]}>
          {solo ? 'Drive my car alone' : 'Ride with me'}
        </Text>
        <Body muted style={{ fontSize: 13 }}>
          {whenLabel(quote.pickupAt)}
        </Body>
      </View>
      <Body muted style={{ marginTop: 12, fontSize: 13 }}>
        {quote.pickup.label}
        {quote.destination ? ` to ${quote.destination.label}` : ''}
      </Body>
      <Text
        accessibilityLabel={`Price ${formatNaira(quote.totalFareKobo)}`}
        style={[styles.fare, { color: colors.ink }]}
      >
        {formatNaira(quote.totalFareKobo)}
      </Text>
      <Text style={[styles.lock, { color: colors.ok }]}>
        {'\u{1F512}'} Price is fixed once a driver accepts
      </Text>

      <View style={{ height: 16 }} />
      <Card>
        {row(
          solo
            ? `Flat fare, about ${quote.distanceKm} km`
            : `${quote.hours} hours at ${formatNaira(quote.hourlyRateKobo)}`,
          formatNaira(quote.baseFareKobo),
        )}
        {quote.isNight ? row('Night trip', formatNaira(quote.nightKobo)) : null}
        {solo && quote.task ? row('Task', quote.task) : null}
        {car ? row('Car', `${car.makeModel} · ${car.plateNumber}`) : null}
        {row('Booking fee', formatNaira(0))}
      </Card>

      <View style={{ height: 16 }} />
      <Body style={{ marginBottom: 8 }}>
        {'✓'} Driver visited in person at home and by two guarantors.
      </Body>
      <Body style={{ marginBottom: 8 }}>{'✓'} Payment is held until your trip ends.</Body>
      <Body muted style={{ fontSize: 13 }}>
        {expired
          ? 'This price has expired. Go back to get a new one.'
          : `This price is held until ${new Date(quote.expiresAt).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' })}.`}
      </Body>
    </FormScreen>
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
  tag: {
    fontFamily: fontFamily.bodyBold,
    fontSize: 12,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  fare: { fontFamily: fontFamily.heading, fontSize: 44, letterSpacing: -1, marginTop: 2 },
  lock: { fontFamily: fontFamily.bodyBold, fontSize: 13, marginTop: 6 },
});
