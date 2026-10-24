import { ApiError, Vehicle } from '@driva/shared';
import {
  Body,
  Button,
  Chips,
  ErrorBanner,
  Field,
  FormHeader,
  FormScreen,
  Title,
  useSession,
} from '@driva/ui';
import { useState } from 'react';

const TRANSMISSIONS = ['Automatic', 'Manual'] as const;

export function AddCar({ onDone, onBack }: { onDone: (car: Vehicle) => void; onBack: () => void }) {
  const { api } = useSession();
  const [makeModel, setMakeModel] = useState('');
  const [plate, setPlate] = useState('');
  const [colour, setColour] = useState('');
  const [transmission, setTransmission] = useState<(typeof TRANSMISSIONS)[number] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setError(null);
    if (!transmission) {
      setError('Choose automatic or manual.');
      return;
    }
    setBusy(true);
    try {
      onDone(
        await api.addVehicle({
          makeModel,
          plateNumber: plate,
          ...(colour.trim() ? { colour: colour.trim() } : {}),
          transmission: transmission === 'Automatic' ? 'automatic' : 'manual',
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
      header={<FormHeader onBack={onBack} />}
      footer={<Button title="Save car" onPress={() => void save()} loading={busy} />}
    >
      <Title>Add your car</Title>
      <Body muted style={{ marginTop: 6, marginBottom: 16 }}>
        The driver drives your own car. They see these details when they accept.
      </Body>
      <ErrorBanner message={error} />
      <Field
        label="Make and model"
        placeholder="Toyota Camry 2018"
        value={makeModel}
        onChangeText={setMakeModel}
      />
      <Field
        label="Plate number"
        placeholder="LND 482 KJ"
        autoCapitalize="characters"
        value={plate}
        onChangeText={setPlate}
      />
      <Field label="Colour" hint="(optional)" value={colour} onChangeText={setColour} />
      <Chips
        label="Gearbox"
        options={TRANSMISSIONS}
        value={transmission}
        onChange={setTransmission}
      />
    </FormScreen>
  );
}
