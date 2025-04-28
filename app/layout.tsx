import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Stitchflow Shadow IT Scanner',
  description: 'Stitchflow Shadow IT Scanner',
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
