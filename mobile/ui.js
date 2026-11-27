import React from 'react';
import Svg, { Path } from 'react-native-svg';

export const colors = {
  primary: '#512477',
  deep: '#352052',
  background: '#F8F5FA',
  surface: '#FFFFFF',
  ink: '#261934',
  muted: '#5B4969',
  soft: '#EFE7F7',
  border: '#E4D9EB',
  outline: '#877393',
  onPrimary: '#FFFFFF',
  onDeep: '#F1E7FA',
};

const paths = {
  home: 'M3 10l9-7 9 7v10H3z M9 20v-6h6v6',
  search: 'M16 16l5 5 M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0z',
  heart: 'M20.8 9.1c0 4.2-8.8 9.6-8.8 9.6s-8.8-5.4-8.8-9.6a4.5 4.5 0 0 1 8.8-1.3 4.5 4.5 0 0 1 8.8 1.3z',
  account: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0z',
  pin: 'M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0z M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  ticket: 'M3 8l13-5 1 3 M3 9h18v3a2 2 0 1 0 0 4v4H3v-4a2 2 0 1 0 0-4z M15 11v2m0 3v2',
  food: 'M4 3v5a3 3 0 0 0 6 0V3 M7 3v18 M20 3v18 M20 3c-4 0-5 5-5 10h5',
  fun: 'M7 7h10c2 0 3 2 4 5l1 3a2 2 0 0 1-3 2l-3-2H8l-3 2a2 2 0 0 1-3-2l1-3c1-3 2-5 4-5z M6 11h4m-2-2v4m7-2h.1m3 0h.1',
  travel: 'M22 2 9 15 M22 2l-8 20-5-7-7-5 20-8z',
  stay: 'M3 18V6m18 12v-6H3m0 4h18 M7 12V9h4v3m2 0V8h5a3 3 0 0 1 3 3',
  other: 'M12 3v18m-9-9h18 M6 6l12 12m0-12L6 18',
  check: 'm5 12 5 5 9-10',
};

export function Icon({ name, color = colors.primary, size = 24, filled = false }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}
    accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <Path d={paths[name]} fill={filled ? color : 'none'} stroke={color} strokeWidth={1.75}
      strokeLinecap="round" strokeLinejoin="round" />
  </Svg>;
}
