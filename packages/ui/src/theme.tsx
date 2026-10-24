import {
  BricolageGrotesque_700Bold,
  BricolageGrotesque_800ExtraBold,
} from '@expo-google-fonts/bricolage-grotesque';
import { DMSans_400Regular, DMSans_500Medium, DMSans_700Bold } from '@expo-google-fonts/dm-sans';
import { useFonts } from 'expo-font';
import { createContext, ReactNode, useContext } from 'react';
import { useColorScheme } from 'react-native';
import { brand, ColorTokens, darkColors, lightColors } from './tokens';

export const fontFamily = {
  heading: 'BricolageGrotesque_800ExtraBold',
  headingBold: 'BricolageGrotesque_700Bold',
  body: 'DMSans_400Regular',
  bodyMedium: 'DMSans_500Medium',
  bodyBold: 'DMSans_700Bold',
} as const;

/** Loads Bricolage Grotesque and DM Sans. Returns true once they are ready. */
export function useDrivaFonts(): boolean {
  const [loaded] = useFonts({
    [fontFamily.heading]: BricolageGrotesque_800ExtraBold,
    [fontFamily.headingBold]: BricolageGrotesque_700Bold,
    [fontFamily.body]: DMSans_400Regular,
    [fontFamily.bodyMedium]: DMSans_500Medium,
    [fontFamily.bodyBold]: DMSans_700Bold,
  });
  return loaded;
}

export interface Theme {
  dark: boolean;
  colors: ColorTokens & { navy: string };
}

const ThemeContext = createContext<Theme>({
  dark: false,
  colors: { ...lightColors, navy: brand.navy },
});

/** Follows the phone's light or dark setting, like the prototype. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const dark = useColorScheme() === 'dark';
  const theme: Theme = { dark, colors: { ...(dark ? darkColors : lightColors), navy: brand.navy } };
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
