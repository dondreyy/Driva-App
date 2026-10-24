import {
  ApiError,
  AuthApp,
  formatNigerianPhone,
  normalizeNigerianPhone,
  OTP_LENGTH,
} from '@driva/shared';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import {
  Body,
  Button,
  CheckRow,
  ErrorBanner,
  Field,
  FormHeader,
  FormScreen,
  LinkButton,
  Title,
} from '../components';
import { useSession } from './session';

const RESEND_SECONDS = 60;

type Step = 'phone' | 'code' | 'profile';

/** The mobile apps. Staff sign in on the admin dashboard instead. */
export type MobileApp = Exclude<AuthApp, 'admin'>;

const COPY: Record<MobileApp, { profileSub: string; done: string }> = {
  client: {
    profileSub:
      'We use your name on your trips. Your emergency contact is alerted if you press the emergency button.',
    done: 'Create account',
  },
  driver: {
    profileSub: 'Tell us who you are. You add your documents and guarantors next.',
    done: 'Create account',
  },
};

/**
 * Phone number, then SMS code, then (for a new number) name and consent.
 * The same flow signs people in and signs them up.
 */
export function AuthFlow({ app, onBack }: { app: MobileApp; onBack: () => void }) {
  const { api, signIn } = useSession();
  const [step, setStep] = useState<Step>('phone');
  const [phoneInput, setPhoneInput] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [signupToken, setSignupToken] = useState('');
  const [fullName, setFullName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

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

  const sendCode = (to: string) =>
    run(async () => {
      await api.requestOtp({ phone: to });
      setPhone(to);
      setCode('');
      setResendIn(RESEND_SECONDS);
      setStep('code');
    });

  function submitPhone() {
    const normalized = normalizeNigerianPhone(phoneInput);
    if (!normalized) {
      setError('Enter a Nigerian mobile number, for example 0803 000 0000.');
      return;
    }
    void sendCode(normalized);
  }

  function submitCode() {
    if (!new RegExp(`^\\d{${OTP_LENGTH}}$`).test(code)) {
      setError(`Enter the ${OTP_LENGTH} digit code.`);
      return;
    }
    void run(async () => {
      const result = await api.verifyOtp({ phone, code, app });
      if (result.status === 'signed_in') {
        await signIn(result);
      } else {
        setSignupToken(result.signupToken);
        setStep('profile');
      }
    });
  }

  function submitProfile() {
    if (fullName.trim().length < 2) {
      setError('Enter your full name.');
      return;
    }
    const hasContact = contactName.trim() !== '' || contactPhone.trim() !== '';
    const contact = normalizeNigerianPhone(contactPhone);
    if (hasContact && (contactName.trim().length < 2 || !contact)) {
      setError(
        'Give your emergency contact a name and a Nigerian mobile number, or leave both empty.',
      );
      return;
    }
    if (!consent) {
      setError('Tick the box to agree before we create your account.');
      return;
    }
    void run(async () => {
      const result = await api.signup({
        signupToken,
        fullName: fullName.trim(),
        consent: true,
        ...(hasContact
          ? { emergencyContactName: contactName.trim(), emergencyContactPhone: contact! }
          : {}),
      });
      await signIn(result);
    });
  }

  const back = () => {
    setError(null);
    if (step === 'phone') onBack();
    else setStep('phone');
  };

  if (step === 'phone') {
    return (
      <FormScreen
        header={<FormHeader onBack={back} step={1} total={3} />}
        footer={<Button title="Send code" onPress={submitPhone} loading={busy} />}
      >
        <Title>Your phone number</Title>
        <Body muted style={{ marginTop: 6, marginBottom: 16 }}>
          We text you a code to sign in or create your account.
        </Body>
        <ErrorBanner message={error} />
        <Field
          label="Phone number"
          placeholder="0803 000 0000"
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          autoComplete="tel"
          autoFocus
          value={phoneInput}
          onChangeText={setPhoneInput}
          onSubmitEditing={submitPhone}
        />
      </FormScreen>
    );
  }

  if (step === 'code') {
    return (
      <FormScreen
        header={<FormHeader onBack={back} step={2} total={3} />}
        footer={
          <View>
            <Button title="Verify and continue" onPress={submitCode} loading={busy} />
            <LinkButton
              title={resendIn > 0 ? `Send a new code in ${resendIn}s` : 'Send a new code'}
              disabled={resendIn > 0 || busy}
              onPress={() => void sendCode(phone)}
            />
          </View>
        }
      >
        <Title>Enter the code</Title>
        <Body muted style={{ marginTop: 6, marginBottom: 16 }}>
          We sent a {OTP_LENGTH} digit code to {formatNigerianPhone(phone)}.
        </Body>
        <ErrorBanner message={error} />
        <Field
          label="Code"
          placeholder={'0'.repeat(OTP_LENGTH)}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="sms-otp"
          maxLength={OTP_LENGTH}
          autoFocus
          value={code}
          onChangeText={(text) => setCode(text.replace(/\D/g, ''))}
          onSubmitEditing={submitCode}
        />
      </FormScreen>
    );
  }

  return (
    <FormScreen
      header={<FormHeader onBack={back} step={3} total={3} />}
      footer={<Button title={COPY[app].done} onPress={submitProfile} loading={busy} />}
    >
      <Title>About you</Title>
      <Body muted style={{ marginTop: 6, marginBottom: 16 }}>
        {COPY[app].profileSub}
      </Body>
      <ErrorBanner message={error} />
      <Field
        label="Full name"
        placeholder="Tolu Adebayo"
        textContentType="name"
        autoComplete="name"
        value={fullName}
        onChangeText={setFullName}
      />
      <Body bold style={{ marginTop: 6, marginBottom: 8, fontSize: 13 }}>
        Emergency contact
        <Body muted> (optional)</Body>
      </Body>
      <Field label="Contact name" value={contactName} onChangeText={setContactName} />
      <Field
        label="Contact phone number"
        keyboardType="phone-pad"
        value={contactPhone}
        onChangeText={setContactPhone}
      />
      <CheckRow checked={consent} onChange={setConsent}>
        I agree to the Driva terms and privacy notice, and to Driva keeping a record that I agreed.
      </CheckRow>
    </FormScreen>
  );
}
