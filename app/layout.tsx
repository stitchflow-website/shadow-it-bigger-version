import type { Metadata } from 'next'
import './globals.css'
import Link from 'next/link';
import { Suspense } from 'react';

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
      <body>
        <Suspense fallback={<div>Loading...</div>}>
          {children}
        </Suspense>
      </body>
      {/* <footer className="bottom-0 left-0 right-0 flex justify-between items-center px-4 py-3 bg-[#1a1a2e] text-white">
        <div className="flex items-center gap-4">
          <Link href="/" className="hover:text-blue-500 transition-colors">
            stitchflow.com
          </Link>
          <Link href="/privacy" className="hover:text-blue-500 transition-colors">
            Privacy Policy
          </Link>
          <Link href="/terms-of-service" className="hover:text-blue-500 transition-colors">
            Terms of Service
          </Link>
        </div>
        <a 
          href="mailto:contact@stitchflow.io" 
          className="hover:text-blue-500 transition-colors"
        >
          contact@stitchflow.io
        </a>
      </footer> */}
    </html>
  )
}
