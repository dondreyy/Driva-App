import { CheckStatus, DriverApplication, VettingStep } from '@driva/shared';
import {
  Body,
  Button,
  FormScreen,
  LinkButton,
  StepList,
  StepState,
  Title,
  useSession,
} from '@driva/ui';
import { View } from 'react-native';

/** The prototype's progress list. Both guarantor visits show as one line. */
const LINES: { label: string; steps: VettingStep[] }[] = [
  { label: 'Documents checked', steps: ['documents'] },
  { label: 'Home visit', steps: ['home_visit'] },
  { label: 'Guarantor visits', steps: ['guarantor_visit_1', 'guarantor_visit_2'] },
  { label: 'Criminal record check', steps: ['criminal_record'] },
  { label: 'Approved', steps: ['final_review'] },
];

export function vettingLines(app: DriverApplication): { label: string; state: StepState }[] {
  const status = (step: VettingStep): CheckStatus =>
    app.vetting.find((c) => c.step === step)?.status ?? 'pending';
  let currentFound = false;
  const lines = LINES.map(({ label, steps }) => {
    const statuses = steps.map(status);
    let state: StepState = 'todo';
    if (statuses.includes('failed')) state = 'failed';
    else if (statuses.every((s) => s === 'passed')) state = 'done';
    else if (!currentFound && app.status === 'in_vetting') {
      state = 'now';
      currentFound = true;
    }
    return { label, state };
  });
  return [{ label: 'Application received', state: 'done' as StepState }, ...lines];
}

export function VettingStatus({
  application,
  onRefresh,
  refreshing,
}: {
  application: DriverApplication;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const { user, signOut } = useSession();
  const firstName = user?.fullName.split(' ')[0] ?? 'you';
  const copy = {
    approved: [
      'You are approved',
      'You can go online and accept trips. Going online arrives in the next update.',
    ],
    rejected: ['We could not approve you', 'VeriQuest will contact you to explain the decision.'],
    suspended: ['Your account is paused', 'Contact Driva support to find out more.'],
    in_vetting: [
      'Vetting in progress',
      `VeriQuest will call ${firstName} to book your home visit.`,
    ],
  }[application.status as 'approved' | 'rejected' | 'suspended' | 'in_vetting'];

  return (
    <FormScreen
      footer={
        <View>
          <Button
            title="Check for updates"
            variant="dark"
            onPress={onRefresh}
            loading={refreshing}
          />
          <LinkButton title="Sign out" onPress={() => void signOut()} />
        </View>
      }
    >
      <View style={{ height: 24 }} />
      <Title size={28}>{copy[0]}</Title>
      <Body muted style={{ marginTop: 6, marginBottom: 20 }}>
        {copy[1]}
      </Body>
      <StepList steps={vettingLines(application)} />
    </FormScreen>
  );
}
