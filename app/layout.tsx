'use client'

import './globals.css'
import { Analytics } from '@vercel/analytics/react'
import { ApiFetchAuth } from '@/app/components/ApiFetchAuth'
import AnnouncementBanner from '@/app/components/AnnouncementBanner'
import { FirstTimeHereProvider } from '@/app/components/FirstTimeHere'
import { CreditWarningsRoot } from '@/components/credits/CreditWarningsRoot'
import InAppBrowserGuard from '@/components/InAppBrowserGuard'

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ko">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/icon-180x180.png" />
        <link rel="icon" href="/icon-32x32.png" sizes="32x32" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content="AIMANI" />
        <meta name="theme-color" content="#0b1020" />
        <meta
          name="google-site-verification"
          content="8k-wO6mSk6PjlWP18amCIjacryQ3t3IEU0QyqHM7OqY"
        />
      </head>
      <body>
        <AnnouncementBanner />
        <InAppBrowserGuard />
        <CreditWarningsRoot>
          <FirstTimeHereProvider>
            <ApiFetchAuth />
            {children}
          </FirstTimeHereProvider>
        </CreditWarningsRoot>
        <Analytics />
      </body>
    </html>
  )
}