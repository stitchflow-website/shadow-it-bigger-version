import type { Metadata } from 'next'
import './globals.css'
import Link from 'next/link';
import { Suspense } from 'react';
import Script from 'next/script';

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
      <head>
        
        <Script
          dangerouslySetInnerHTML={{
            __html: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','GTM-K8ZP8PLV');`
          }}
        />
        {/* End Google Tag Manager */}

        <meta charSet="UTF-8" />
        <link rel="icon" type="image/png" href="https://cdn.prod.website-files.com/648b3fb5ff20b9eb641b8ea2/65b1d6fd463f7ec764b594e6_Group%207.png" />
        <link rel="canonical" href="https://www.stitchflow.com/tools/shadow-it-scan" />
      </head>
      <body>
        {/* Google Tag Manager (noscript) */}
        <noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-K8ZP8PLV"
        height="0" width="0" style={{display: 'none', visibility: 'hidden'}}></iframe></noscript>
        {/* End Google Tag Manager (noscript) */}
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
