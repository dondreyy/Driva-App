import { ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fontFamily, useTheme } from './theme';

/** A form screen: optional header, scrolling body and a footer for the main action. */
export function FormScreen({
  header,
  children,
  footer,
}: {
  header?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: colors.bg }]}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {header}
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** Back button and "1 of 3" progress, as in the prototype's forms. */
export function FormHeader({
  onBack,
  step,
  total,
}: {
  onBack?: () => void;
  step?: number;
  total?: number;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.header}>
      {onBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack}
          style={[styles.iconButton, { borderColor: colors.line, backgroundColor: colors.surface }]}
        >
          <Text style={[styles.backArrow, { color: colors.ink }]}>{'←'}</Text>
        </Pressable>
      ) : null}
      {step && total ? (
        <>
          <View
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: total, now: step }}
            style={[styles.progress, { backgroundColor: colors.soft }]}
          >
            <View
              style={[
                styles.progressFill,
                { width: `${Math.round((step / total) * 100)}%`, backgroundColor: colors.amber },
              ]}
            />
          </View>
          <Text style={[styles.small, { color: colors.muted }]}>
            {step} of {total}
          </Text>
        </>
      ) : null}
    </View>
  );
}

export function Title({ children, size = 26 }: { children: ReactNode; size?: number }) {
  const { colors } = useTheme();
  return (
    <Text accessibilityRole="header" style={[styles.title, { color: colors.ink, fontSize: size }]}>
      {children}
    </Text>
  );
}

export function Body({
  children,
  muted,
  bold,
  style,
}: {
  children: ReactNode;
  muted?: boolean;
  bold?: boolean;
  style?: object;
}) {
  const { colors } = useTheme();
  return (
    <Text
      style={[
        styles.body15,
        { color: muted ? colors.muted : colors.ink },
        bold && { fontFamily: fontFamily.bodyBold },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

export function Field({
  label,
  hint,
  ...input
}: { label: string; hint?: string } & TextInputProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.ink }]}>
        {label}
        {hint ? (
          <Text style={{ color: colors.muted, fontFamily: fontFamily.bodyMedium }}> {hint}</Text>
        ) : null}
      </Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        style={[
          styles.input,
          { borderColor: colors.line, backgroundColor: colors.surface, color: colors.ink },
        ]}
        {...input}
      />
    </View>
  );
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'dark' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
}) {
  const { colors } = useTheme();
  const look = {
    primary: { bg: colors.amber, fg: colors.navy, border: colors.amber },
    dark: { bg: colors.navy, fg: '#FFFFFF', border: colors.navy },
    ghost: { bg: 'transparent', fg: colors.ink, border: colors.line },
  }[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: look.bg, borderColor: look.border },
        (disabled || loading) && { opacity: 0.4 },
        pressed && { transform: [{ scale: 0.98 }] },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={look.fg} />
      ) : (
        <Text style={[styles.buttonText, { color: look.fg }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function LinkButton({
  title,
  onPress,
  disabled,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled} style={styles.link}>
      <Text style={[styles.linkText, { color: disabled ? colors.muted : colors.ink }]}>
        {title}
      </Text>
    </Pressable>
  );
}

export function CheckRow({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={() => onChange(!checked)}
      style={[
        styles.check,
        { borderColor: checked ? colors.navy : colors.line, backgroundColor: colors.surface },
      ]}
    >
      <View
        style={[
          styles.box,
          { borderColor: checked ? colors.amber : colors.line },
          checked && { backgroundColor: colors.amber },
        ]}
      >
        {checked ? <Text style={[styles.tick, { color: colors.navy }]}>{'✓'}</Text> : null}
      </View>
      <Text style={[styles.body15, { color: colors.ink, flex: 1 }]}>{children}</Text>
    </Pressable>
  );
}

export function ErrorBanner({ message }: { message: string | null }) {
  const { colors } = useTheme();
  if (!message) return null;
  return (
    <View
      accessibilityRole="alert"
      style={[styles.banner, { backgroundColor: colors.warnBg, borderColor: colors.warn }]}
    >
      <Text style={[styles.body15, { color: colors.warn }]}>{message}</Text>
    </View>
  );
}

export function Card({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  body: { padding: 20, paddingTop: 8, flexGrow: 1 },
  footer: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 20 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
    minHeight: 68,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backArrow: { fontSize: 20, fontFamily: fontFamily.bodyBold },
  progress: { flex: 1, height: 6, borderRadius: 6, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 6 },
  small: { fontSize: 13, fontFamily: fontFamily.bodyMedium },
  title: { fontFamily: fontFamily.heading, letterSpacing: -0.3, lineHeight: 32 },
  body15: { fontSize: 15, lineHeight: 22, fontFamily: fontFamily.body },
  field: { marginBottom: 14 },
  label: { fontSize: 13, fontFamily: fontFamily.bodyBold, marginBottom: 6 },
  input: {
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
    fontFamily: fontFamily.body,
  },
  button: {
    borderRadius: 18,
    borderWidth: 1.5,
    paddingVertical: 16,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
  },
  buttonText: { fontFamily: fontFamily.heading, fontSize: 16 },
  link: { alignSelf: 'center', paddingVertical: 12, paddingHorizontal: 8 },
  linkText: { fontFamily: fontFamily.bodyBold, fontSize: 15, textDecorationLine: 'underline' },
  check: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
    borderWidth: 1.5,
    borderRadius: 16,
    padding: 12,
    marginTop: 6,
  },
  box: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  tick: { fontSize: 14, fontFamily: fontFamily.bodyBold, lineHeight: 16 },
  banner: { borderWidth: 1.5, borderRadius: 16, padding: 12, marginBottom: 14 },
  card: { borderWidth: 1, borderRadius: 20, padding: 16 },
});
