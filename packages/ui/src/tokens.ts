/** Design tokens taken from docs/prototype/DrivaRedesign.html. */

export const brand = {
  navy: '#0B2545',
  amber: '#F5A524',
} as const;

export const lightColors = {
  bg: '#F7F4EE',
  surface: '#FFFFFF',
  ink: '#0B2545',
  muted: '#5A6A82',
  line: '#E7E1D4',
  soft: '#EFEADF',
  amber: brand.amber,
  amberSoft: '#FFF3D6',
  ok: '#16794A',
  okBg: '#DFF2E6',
  warn: '#B3261E',
  warnBg: '#FBE4E1',
  chipOnBg: '#0B2545',
  chipOnInk: '#FFFFFF',
} as const;

export type ColorTokens = { [K in keyof typeof lightColors]: string };

export const darkColors: ColorTokens = {
  bg: '#07152A',
  surface: '#0F2440',
  ink: '#EEF3FA',
  muted: '#9BB0CC',
  line: '#1F3B65',
  soft: '#14294A',
  amber: brand.amber,
  amberSoft: '#2E2A18',
  ok: '#6FD6A0',
  okBg: '#10382A',
  warn: '#FF8A80',
  warnBg: '#3A1C1C',
  chipOnBg: '#F5A524',
  chipOnInk: '#0B2545',
};

export const mapColors = {
  light: {
    land: '#FFFFFF',
    block: '#EEE8DA',
    water: '#BFD8EC',
    park: '#D3E5CC',
    avenue: '#FBE9BE',
    route: '#0B2545',
    casing: '#FFFFFF',
    label: '#5A6A82',
  },
  dark: {
    land: '#0B1D38',
    block: '#10294D',
    water: '#0A3558',
    park: '#0F3B35',
    avenue: '#2B3B52',
    route: '#F5A524',
    casing: '#07152A',
    label: '#9BB0CC',
  },
} as const;

export const fonts = {
  heading: 'Bricolage Grotesque',
  body: 'DM Sans',
} as const;
