import { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { brand } from './tokens';
import { fontFamily, useTheme } from './theme';

/** The navy hero and the card below it, as on the prototype's welcome screen. */
export function Welcome({
  brandName,
  title,
  body,
  trust,
  children,
}: {
  brandName: string;
  title: string;
  body: string;
  trust: string[];
  children: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.fill, { backgroundColor: brand.navy }]}>
      <SafeAreaView edges={['top']} style={styles.hero}>
        <View style={styles.brandRow}>
          <View style={styles.logo}>
            <Text style={styles.logoLetter}>D</Text>
          </View>
          <Text style={styles.word}>{brandName}</Text>
        </View>
        <Text accessibilityRole="header" style={styles.h1}>
          {title}
        </Text>
        <Text style={styles.lead}>{body}</Text>
        <View style={styles.road}>
          <View style={styles.lane} />
        </View>
      </SafeAreaView>
      <SafeAreaView edges={['bottom']} style={[styles.card, { backgroundColor: colors.bg }]}>
        <View style={styles.trust}>
          {trust.map((item) => (
            <View
              key={item}
              style={[
                styles.trustItem,
                { backgroundColor: colors.surface, borderColor: colors.line },
              ]}
            >
              <Text style={[styles.trustTick, { color: colors.ok }]}>{'✓'}</Text>
              <Text style={[styles.trustText, { color: colors.ink }]}>{item}</Text>
            </View>
          ))}
        </View>
        {children}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  hero: { flex: 1, paddingHorizontal: 22, paddingTop: 22, paddingBottom: 26 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: brand.amber,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoLetter: { fontFamily: fontFamily.heading, fontSize: 22, color: brand.navy },
  word: { fontFamily: fontFamily.heading, fontSize: 24, color: '#FFFFFF', letterSpacing: -0.5 },
  h1: {
    fontFamily: fontFamily.heading,
    fontSize: 36,
    lineHeight: 38,
    color: '#FFFFFF',
    marginTop: 26,
    letterSpacing: -0.4,
  },
  lead: {
    fontFamily: fontFamily.body,
    fontSize: 15,
    lineHeight: 22,
    color: '#C5D2E6',
    marginTop: 12,
    maxWidth: 320,
  },
  road: {
    marginTop: 'auto',
    height: 38,
    backgroundColor: '#07152A',
    marginHorizontal: -22,
    justifyContent: 'center',
  },
  lane: {
    height: 2,
    marginHorizontal: 0,
    borderTopWidth: 2,
    borderStyle: 'dashed',
    borderColor: 'rgba(245,165,36,0.7)',
  },
  card: {
    marginTop: -26,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    paddingBottom: 22,
  },
  trust: { flexDirection: 'row', gap: 6, marginBottom: 16 },
  trustItem: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderWidth: 1,
    borderRadius: 16,
  },
  trustTick: { fontFamily: fontFamily.bodyBold, fontSize: 18 },
  trustText: { fontFamily: fontFamily.bodyBold, fontSize: 12, textAlign: 'center' },
});
