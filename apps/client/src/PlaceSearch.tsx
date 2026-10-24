import { Place, PlaceSuggestion } from '@driva/shared';
import { Body, fontFamily, useSession, useTheme } from '@driva/ui';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

/** Search box with suggestions. Calls onPick with the chosen place's coordinates. */
export function PlaceSearch({
  label,
  placeholder,
  value,
  near,
  onPick,
}: {
  label: string;
  placeholder: string;
  value: Place | null;
  near: { lat: number; lng: number } | null;
  onPick: (place: Place) => void;
}) {
  const { api } = useSession();
  const { colors } = useTheme();
  const [text, setText] = useState('');
  // Show the chosen place unless the user taps Change; with no place yet, show the search box.
  const [editing, setEditing] = useState(false);
  const [results, setResults] = useState<PlaceSuggestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (text.trim().length < 2) {
      setResults([]);
      return;
    }
    // Wait for a pause in typing so each keystroke is not a paid lookup.
    timer.current = setTimeout(() => {
      api
        .placeSearch(text.trim(), near ?? undefined)
        .then((r) => {
          setResults(r);
          setError(r.length ? null : 'No matching places');
        })
        .catch(() => setError('Search is not available. Try again.'));
    }, 300);
  }, [text, near, api]);

  async function pick(s: PlaceSuggestion) {
    try {
      const place = await api.placeDetails(s.placeId);
      onPick({ ...place, label: s.title });
      setText('');
      setResults([]);
      setEditing(false);
    } catch {
      setError('Could not load that place. Try again.');
    }
  }

  if (value && !editing) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value.label}. Change`}
        onPress={() => setEditing(true)}
        style={[styles.chosen, { borderColor: colors.line, backgroundColor: colors.surface }]}
      >
        <Text style={[styles.pin, { color: colors.amber }]}>{'●'}</Text>
        <View style={{ flex: 1 }}>
          <Text style={[styles.small, { color: colors.muted }]}>{label}</Text>
          <Text style={[styles.place, { color: colors.ink }]}>{value.label}</Text>
        </View>
        <Text style={[styles.change, { color: colors.ink }]}>Change</Text>
      </Pressable>
    );
  }

  return (
    <View style={{ marginBottom: 6 }}>
      <Text style={[styles.label, { color: colors.ink }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        value={text}
        onChangeText={setText}
        autoCorrect={false}
        style={[
          styles.input,
          { borderColor: colors.line, backgroundColor: colors.surface, color: colors.ink },
        ]}
      />
      {results.map((r) => (
        <Pressable
          key={r.placeId}
          accessibilityRole="button"
          accessibilityLabel={`${r.title}, ${r.subtitle}`}
          onPress={() => void pick(r)}
          style={[styles.result, { borderColor: colors.line }]}
        >
          <Text style={[styles.place, { color: colors.ink }]}>{r.title}</Text>
          <Text style={[styles.small, { color: colors.muted }]}>{r.subtitle}</Text>
        </Pressable>
      ))}
      {error && text.trim().length >= 2 ? (
        <Body muted style={{ marginTop: 6, fontSize: 13 }}>
          {error}
        </Body>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontFamily: fontFamily.bodyBold, marginBottom: 6 },
  input: {
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
    fontFamily: fontFamily.body,
  },
  result: { paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: 1 },
  chosen: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1.5,
    borderRadius: 16,
    padding: 12,
    marginBottom: 8,
  },
  pin: { fontSize: 14 },
  small: { fontSize: 12, fontFamily: fontFamily.bodyMedium },
  place: { fontSize: 15, fontFamily: fontFamily.bodyBold },
  change: { fontSize: 13, fontFamily: fontFamily.bodyBold, textDecorationLine: 'underline' },
});
