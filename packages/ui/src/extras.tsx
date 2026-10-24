import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { fontFamily, useTheme } from './theme';

/** Single choice chips, like the prototype's "Years of driving" picker. */
export function Chips<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly T[];
  value: T | null;
  onChange: (value: T) => void;
  label: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.block}>
      <Text style={[styles.label, { color: colors.ink }]}>{label}</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.chips}>
        {options.map((option) => {
          const on = option === value;
          return (
            <Pressable
              key={option}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              onPress={() => onChange(option)}
              style={[
                styles.chip,
                {
                  borderColor: on ? colors.chipOnBg : colors.line,
                  backgroundColor: on ? colors.chipOnBg : colors.surface,
                },
              ]}
            >
              <Text style={[styles.chipText, { color: on ? colors.chipOnInk : colors.ink }]}>
                {option}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** A square tile that shows a camera until its photo is saved, as in the prototype. */
export function PhotoTile({
  label,
  done,
  busy,
  onPress,
}: {
  label: string;
  done: boolean;
  busy?: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}${done ? ', added' : ''}`}
      accessibilityState={{ busy, checked: done }}
      disabled={busy}
      onPress={onPress}
      style={[
        styles.tile,
        {
          borderColor: done ? colors.ok : colors.line,
          backgroundColor: done ? colors.okBg : colors.surface,
        },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={colors.ink} />
      ) : (
        <Text style={[styles.tileIcon, { color: done ? colors.ok : colors.muted }]}>
          {done ? '✓' : '◎'}
        </Text>
      )}
      <Text style={[styles.tileText, { color: colors.ink }]}>{label}</Text>
    </Pressable>
  );
}

export type StepState = 'done' | 'now' | 'todo' | 'failed';

/** Vertical progress list, like the prototype's vetting screen. */
export function StepList({ steps }: { steps: { label: string; state: StepState }[] }) {
  const { colors } = useTheme();
  return (
    <View>
      {steps.map((step, i) => {
        const dot = {
          done: { bg: colors.ok, fg: '#FFFFFF', icon: '✓' },
          now: { bg: colors.amber, fg: colors.navy, icon: '' },
          todo: { bg: colors.soft, fg: colors.muted, icon: '' },
          failed: { bg: colors.warn, fg: '#FFFFFF', icon: '×' },
        }[step.state];
        return (
          <View
            key={step.label}
            style={styles.stepRow}
            accessibilityLabel={`${step.label}: ${step.state}`}
          >
            <View style={styles.stepRail}>
              <View style={[styles.dot, { backgroundColor: dot.bg }]}>
                <Text style={[styles.dotText, { color: dot.fg }]}>{dot.icon}</Text>
              </View>
              {i < steps.length - 1 ? (
                <View style={[styles.rail, { backgroundColor: colors.line }]} />
              ) : null}
            </View>
            <Text
              style={[
                styles.stepText,
                { color: step.state === 'todo' ? colors.muted : colors.ink },
                step.state === 'now' && { fontFamily: fontFamily.bodyBold },
              ]}
            >
              {step.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { marginBottom: 14 },
  label: { fontSize: 13, fontFamily: fontFamily.bodyBold, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
  chipText: { fontFamily: fontFamily.bodyBold, fontSize: 14 },
  tile: {
    flex: 1,
    minHeight: 104,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 10,
  },
  tileIcon: { fontSize: 26, fontFamily: fontFamily.bodyBold },
  tileText: { fontFamily: fontFamily.bodyBold, fontSize: 13, textAlign: 'center' },
  stepRow: { flexDirection: 'row', gap: 12, minHeight: 44 },
  stepRail: { alignItems: 'center', width: 24 },
  dot: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  dotText: { fontSize: 13, fontFamily: fontFamily.bodyBold, lineHeight: 16 },
  rail: { width: 2, flex: 1, marginVertical: 2 },
  stepText: { fontFamily: fontFamily.body, fontSize: 15, paddingTop: 2 },
});
