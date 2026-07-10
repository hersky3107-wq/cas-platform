import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '동반자 · AI 생활 동반자',
  description: '어르신을 위한 따뜻한 AI 생활 동반자 — 안부, 건강, 이야기, 일상을 함께합니다.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ko">
      <head>
        <meta name="theme-color" content="#0A5C7A" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
      </head>
      <body>{children}</body>
    </html>
  )
}
