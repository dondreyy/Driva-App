import type { ReactNode } from 'react';
import { Shell } from '../Shell';

export default function VettingLayout({ children }: { children: ReactNode }) {
  return <Shell>{children}</Shell>;
}
