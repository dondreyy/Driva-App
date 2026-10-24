import {
  ApiError,
  DRIVER_DOCUMENT_LABELS,
  DriverApplication,
  DriverDocumentKind,
  normalizeNigerianPhone,
  YEARS_DRIVING,
} from '@driva/shared';
import {
  Body,
  Button,
  Card,
  CheckRow,
  Chips,
  ErrorBanner,
  Field,
  FormHeader,
  FormScreen,
  PhotoTile,
  Title,
  useSession,
} from '@driva/ui';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { takePhoto, uploadPhoto } from './photos';

type YearsDriving = (typeof YEARS_DRIVING)[number];
type Step = 0 | 1 | 2 | 3 | 4;

const ID_DOCUMENTS: DriverDocumentKind[] = ['licence', 'nin', 'passport_photo'];

/** Where to resume: the first step that is not finished. */
function firstOpenStep(app: DriverApplication): Step {
  if (app.status === 'not_started') return 0;
  if (!app.hasProfile) return 1;
  if (ID_DOCUMENTS.some((kind) => !app.documents.includes(kind))) return 2;
  if (!app.homeAddress || app.guarantorCount < 2) return 3;
  return 4;
}

interface GuarantorForm {
  fullName: string;
  phone: string;
  relationship: string;
  address: string;
}
const emptyGuarantor = (): GuarantorForm => ({
  fullName: '',
  phone: '',
  relationship: '',
  address: '',
});

/** The prototype's four step driver registration, saved to the API as the driver goes. */
export function Registration({
  application,
  onChange,
}: {
  application: DriverApplication;
  onChange: (app: DriverApplication) => void;
}) {
  const { api, signOut } = useSession();
  const [step, setStep] = useState<Step>(() => firstOpenStep(application));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<DriverDocumentKind | null>(null);

  const [cities, setCities] = useState<{ id: string; name: string }[]>([]);
  const [cityId, setCityId] = useState<string | null>(application.cityId);
  const [nin, setNin] = useState('');
  const [licence, setLicence] = useState('');
  const [years, setYears] = useState<YearsDriving | null>(
    (application.yearsDriving as YearsDriving | null) ?? null,
  );
  const [homeAddress, setHomeAddress] = useState(application.homeAddress ?? '');
  const [guarantors, setGuarantors] = useState<[GuarantorForm, GuarantorForm]>([
    emptyGuarantor(),
    emptyGuarantor(),
  ]);
  const [rulesOk, setRulesOk] = useState(false);
  const [consents, setConsents] = useState({ home: false, guarantors: false, checks: false });

  useEffect(() => {
    api
      .cities()
      .then((list) => {
        setCities(list);
        if (!cityId && list.length === 1) setCityId(list[0]!.id);
      })
      .catch(() => setError('Could not load cities. Check your connection.'));
    // Only on first show; cityId is deliberately read once.
  }, []);

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

  async function addPhoto(kind: DriverDocumentKind) {
    setError(null);
    try {
      const photo = await takePhoto(kind === 'selfie');
      if (!photo) return;
      setUploading(kind);
      const ticket = await api.documentUpload(kind, { contentType: photo.contentType });
      await uploadPhoto(ticket, photo);
      onChange(await api.saveDocument(kind, ticket.key));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The photo did not upload.');
    } finally {
      setUploading(null);
    }
  }

  const has = (kind: DriverDocumentKind) => application.documents.includes(kind);
  const back = () => {
    setError(null);
    setStep((s) => (s > 0 ? ((s - 1) as Step) : s));
  };
  const header = (n: Step) => (
    <FormHeader onBack={n > 0 ? back : undefined} step={n || undefined} total={4} />
  );

  if (step === 0) {
    return (
      <FormScreen
        header={header(0)}
        footer={
          <View>
            <Button title="Start registration" onPress={() => setStep(1)} />
            <View style={{ height: 8 }} />
            <Button title="Sign out" variant="ghost" onPress={() => void signOut()} />
          </View>
        }
      >
        <Title>Drive with Driva</Title>
        <Body muted style={{ marginTop: 6, marginBottom: 16 }}>
          Every Driva driver is verified in person by VeriQuest before their first trip.
        </Body>
        <Card>
          <Body bold style={{ fontSize: 17, marginBottom: 10 }}>
            What you will need
          </Body>
          {[
            'Your NIN and a valid driving licence',
            'A passport photograph and a selfie',
            'Two guarantors who agree to a home visit',
            'A home visit by a VeriQuest officer',
          ].map((item) => (
            <Body key={item} style={{ marginBottom: 6 }}>
              {'✓  '}
              {item}
            </Body>
          ))}
        </Card>
      </FormScreen>
    );
  }

  if (step === 1) {
    const saved = application.hasProfile && !nin && !licence;
    const next = () =>
      saved
        ? setStep(2)
        : run(async () => {
            if (!cityId) throw new Error('Choose your city.');
            if (!years) throw new Error('Choose how long you have driven.');
            onChange(
              await api.saveDriverProfile({
                cityId,
                nin,
                licenceNumber: licence,
                yearsDriving: years,
              }),
            );
            setNin('');
            setLicence('');
            setStep(2);
          });
    return (
      <FormScreen
        header={header(1)}
        footer={<Button title="Continue" onPress={() => void next()} loading={busy} />}
      >
        <Title>About you</Title>
        <Body muted style={{ marginTop: 6, marginBottom: 16 }}>
          These must match your ID.
          {saved ? ' Already saved. Fill them in again only to change them.' : ''}
        </Body>
        <ErrorBanner message={error} />
        {cities.length > 1 ? (
          <Chips
            label="City"
            options={cities.map((c) => c.name)}
            value={cities.find((c) => c.id === cityId)?.name ?? null}
            onChange={(name) => setCityId(cities.find((c) => c.name === name)!.id)}
          />
        ) : null}
        <Field
          label="NIN"
          placeholder="11 digits"
          keyboardType="number-pad"
          maxLength={11}
          value={nin}
          onChangeText={(t) => setNin(t.replace(/\D/g, ''))}
        />
        <Field
          label="Driving licence number"
          autoCapitalize="characters"
          value={licence}
          onChangeText={setLicence}
        />
        <Chips label="Years of driving" options={YEARS_DRIVING} value={years} onChange={setYears} />
      </FormScreen>
    );
  }

  if (step === 2) {
    const ready = ID_DOCUMENTS.every(has);
    return (
      <FormScreen
        header={header(2)}
        footer={
          <Button
            title="Continue"
            onPress={() => (ready ? setStep(3) : setError('Add a photo of each document.'))}
          />
        }
      >
        <Title>Your documents</Title>
        <Body muted style={{ marginTop: 6, marginBottom: 16 }}>
          Clear photos of the original documents. Only VeriQuest officers can see them.
        </Body>
        <ErrorBanner message={error} />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {ID_DOCUMENTS.map((kind) => (
            <PhotoTile
              key={kind}
              label={DRIVER_DOCUMENT_LABELS[kind]}
              done={has(kind)}
              busy={uploading === kind}
              onPress={() => void addPhoto(kind)}
            />
          ))}
        </View>
      </FormScreen>
    );
  }

  if (step === 3) {
    const saved = !!application.homeAddress && application.guarantorCount >= 2;
    const typed = guarantors.some((g) => Object.values(g).some((v) => v.trim()));
    const setG = (i: 0 | 1, field: keyof GuarantorForm, value: string) =>
      setGuarantors((gs) => {
        const next = [...gs] as [GuarantorForm, GuarantorForm];
        next[i] = { ...next[i], [field]: value };
        return next;
      });
    const next = () =>
      run(async () => {
        if (homeAddress.trim() !== (application.homeAddress ?? '')) {
          onChange(await api.saveDriverHome({ homeAddress }));
        }
        if (typed || !saved) {
          for (const g of guarantors) {
            if (!normalizeNigerianPhone(g.phone))
              throw new Error(
                `Enter a Nigerian mobile number for ${g.fullName || 'each guarantor'}.`,
              );
          }
          onChange(await api.saveGuarantors({ guarantors, confirmRules: rulesOk as true }));
        }
        setStep(4);
      });
    return (
      <FormScreen
        header={header(3)}
        footer={<Button title="Continue" onPress={() => void next()} loading={busy} />}
      >
        <Title>Home and guarantors</Title>
        <Body muted style={{ marginTop: 6, marginBottom: 16 }}>
          A VeriQuest officer visits you and each guarantor in person. A guarantor is a working
          adult who has known you for at least 2 years, lives in your city and agrees to the visit.
          {saved ? ' Your guarantors are saved. Fill this in again only to change them.' : ''}
        </Body>
        <ErrorBanner message={error} />
        <Field
          label="Your home address"
          value={homeAddress}
          onChangeText={setHomeAddress}
          multiline
        />
        {([0, 1] as const).map((i) => (
          <View key={i} style={{ marginTop: 8 }}>
            <Card>
              <Body bold style={{ marginBottom: 10 }}>
                Guarantor {i + 1}
              </Body>
              <Field
                label={`Guarantor ${i + 1} full name`}
                value={guarantors[i].fullName}
                onChangeText={(v) => setG(i, 'fullName', v)}
              />
              <Field
                label={`Guarantor ${i + 1} phone number`}
                keyboardType="phone-pad"
                value={guarantors[i].phone}
                onChangeText={(v) => setG(i, 'phone', v)}
              />
              <Field
                label={`Guarantor ${i + 1} relationship and occupation`}
                placeholder="Former employer, pharmacist"
                value={guarantors[i].relationship}
                onChangeText={(v) => setG(i, 'relationship', v)}
              />
              <Field
                label={`Guarantor ${i + 1} home address`}
                value={guarantors[i].address}
                onChangeText={(v) => setG(i, 'address', v)}
              />
            </Card>
          </View>
        ))}
        {typed || !saved ? (
          <CheckRow checked={rulesOk} onChange={setRulesOk}>
            Both guarantors are working adults who have known me for at least 2 years, live in my
            city and agree to a home visit.
          </CheckRow>
        ) : null}
      </FormScreen>
    );
  }

  const submit = () =>
    run(async () => {
      if (!consents.home || !consents.guarantors || !consents.checks) {
        throw new Error('Agree to all three checks to send your application.');
      }
      if (!has('selfie')) throw new Error('Take a selfie so VeriQuest can match you to your ID.');
      if (!application.consentsGiven) {
        onChange(
          await api.saveConsents({
            homeVisit: true,
            guarantorVisits: true,
            idAndCriminalChecks: true,
          }),
        );
      }
      onChange(await api.submitApplication());
    });

  return (
    <FormScreen
      header={header(4)}
      footer={<Button title="Submit application" onPress={() => void submit()} loading={busy} />}
    >
      <Title>Consent and selfie</Title>
      <Body muted style={{ marginTop: 6, marginBottom: 16 }}>
        We need your permission to run the checks.
      </Body>
      <ErrorBanner message={error} />
      <CheckRow checked={consents.home} onChange={(v) => setConsents((c) => ({ ...c, home: v }))}>
        I agree to a home visit. A VeriQuest officer will confirm where I live.
      </CheckRow>
      <CheckRow
        checked={consents.guarantors}
        onChange={(v) => setConsents((c) => ({ ...c, guarantors: v }))}
      >
        I agree to my guarantors being visited at home.
      </CheckRow>
      <CheckRow
        checked={consents.checks}
        onChange={(v) => setConsents((c) => ({ ...c, checks: v }))}
      >
        I agree to ID and criminal record checks against my NIN, licence and police records.
      </CheckRow>
      <Body bold style={{ marginTop: 16, marginBottom: 8, fontSize: 13 }}>
        Selfie
      </Body>
      <View style={{ flexDirection: 'row' }}>
        <PhotoTile
          label="Take a selfie"
          done={has('selfie')}
          busy={uploading === 'selfie'}
          onPress={() => void addPhoto('selfie')}
        />
      </View>
    </FormScreen>
  );
}
