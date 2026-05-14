import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'AI Print Art',
  description: 'Generate print-ready art with AI',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
