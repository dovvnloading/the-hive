import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import './observer.css';
import './observer-art.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

const title = 'The Hive — A Little World of Ideas';
const description =
  'A cozy homestead for curious minds. Explore the rooms, follow the residents, and discover what they are working on.';

export function generateMetadata(): Metadata {
  const metadataBase = new URL(process.env.SITE_URL ?? 'http://localhost:3000');
  return {
    metadataBase,
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
      images: [{ url: '/og.png', width: 1728, height: 907, alt: title }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: ['/og.png'],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
