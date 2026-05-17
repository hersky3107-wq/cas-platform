'use client'

import './globals.css'
import { ApiFetchAuth } from '@/app/components/ApiFetchAuth'

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ko">
      <body>
        <ApiFetchAuth />
        {children}
      </body>
    </html>
  )
}