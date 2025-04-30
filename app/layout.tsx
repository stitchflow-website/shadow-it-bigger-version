import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Free Shadow IT Scanner for SaaS & AI Apps | Stitchflow',
  description: 'With Shadow IT discovery tool, detect all apps tied to your Google Workspace/Microsoft 365, see risky apps ranked by OAuth scopes & get alerts for risky usage',
  generator: 'Stitchflow',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">

      <body>{children}</body>
    </html>
  )
}
