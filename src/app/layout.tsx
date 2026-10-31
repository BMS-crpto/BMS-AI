import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'BMS AI',
  description: 'One intelligence. Unlimited possibilities.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
