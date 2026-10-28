import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'lead — chamber directories to datasets',
  description: 'Turn public Chamber of Commerce member directories into clean, structured business datasets.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Young+Serif&family=Schibsted+Grotesk:wght@400;500;600;700&family=Martian+Mono:wght@300;400;500;700&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
