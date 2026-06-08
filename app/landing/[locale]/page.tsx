import { Metadata } from "next";
import { notFound } from "next/navigation";
import LandingPage from "@/components/landing/LandingPage";
import { landingContent, Locale } from "@/lib/landing/content";

const VALID_LOCALES: Locale[] = ["ko", "ja", "zh-TW", "fr", "ar"];

interface PageProps {
  params: Promise<{ locale: string }>;
}

export function generateStaticParams() {
  return VALID_LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!VALID_LOCALES.includes(locale as Locale)) return {};
  const c = landingContent[locale as Locale];
  return {
    title: c.meta.title,
    description: c.meta.description,
    alternates: {
      languages: {
        en: "https://aimani.ai/landing",
        ko: "https://aimani.ai/landing/ko",
        ja: "https://aimani.ai/landing/ja",
        "zh-TW": "https://aimani.ai/landing/zh-TW",
      },
    },
  };
}

export default async function LocaleLanding({ params }: PageProps) {
  const { locale } = await params;
  if (!VALID_LOCALES.includes(locale as Locale)) notFound();
  return <LandingPage content={landingContent[locale as Locale]} locale={locale as Locale} />;
}
