import { BookingView, QuoteView, Vehicle } from '@driva/shared';
import { useSession } from '@driva/ui';
import { useEffect, useState } from 'react';
import { AddCar } from './AddCar';
import { BookingDraft, BookScreen, newDraft } from './BookScreen';
import { QuoteScreen } from './QuoteScreen';
import { TripScreen } from './TripScreen';

/** Booking for a signed in client: choose the trip, add a car if needed, see the price. */
export function Booking() {
  const { api } = useSession();
  const [screen, setScreen] = useState<'loading' | 'book' | 'car' | 'quote' | 'trip'>('loading');
  const [draft, setDraft] = useState<BookingDraft>(() => newDraft());
  const [cars, setCars] = useState<Vehicle[]>([]);
  const [quote, setQuote] = useState<QuoteView | null>(null);
  const [trip, setTrip] = useState<BookingView | null>(null);

  // Reopen a trip that is still in progress.
  useEffect(() => {
    api
      .currentBooking()
      .then(({ booking }) => {
        setTrip(booking);
        setScreen(booking ? 'trip' : 'book');
      })
      .catch(() => setScreen('book'));
  }, [api]);

  useEffect(() => {
    api
      .vehicles()
      .then((list) => {
        setCars(list);
        if (list.length === 1) setDraft((d) => ({ ...d, carId: d.carId ?? list[0]!.id }));
      })
      .catch(() => undefined);
  }, [api]);

  if (screen === 'loading') return null;
  if (screen === 'trip' && trip) {
    return (
      <TripScreen
        initial={trip}
        onDone={() => {
          setTrip(null);
          setQuote(null);
          setScreen('book');
        }}
      />
    );
  }
  if (screen === 'car') {
    return (
      <AddCar
        onBack={() => setScreen('book')}
        onDone={(car) => {
          setCars((list) => [...list, car]);
          setDraft((d) => ({ ...d, carId: car.id }));
          setScreen('book');
        }}
      />
    );
  }
  if (screen === 'quote' && quote) {
    return (
      <QuoteScreen
        quote={quote}
        car={cars.find((c) => c.id === draft.carId) ?? null}
        onBack={() => setScreen('book')}
        onBooked={(booking) => {
          setTrip(booking);
          setScreen('trip');
        }}
      />
    );
  }
  return (
    <BookScreen
      draft={draft}
      setDraft={setDraft}
      cars={cars}
      onAddCar={() => setScreen('car')}
      onQuote={(q) => {
        setQuote(q);
        setScreen('quote');
      }}
    />
  );
}
