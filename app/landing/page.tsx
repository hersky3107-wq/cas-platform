import { Metadata } from "next";
import LandingPage from "@/components/landing/LandingPage";
import { landingContent } from "@/lib/landing/content";

const c = landingContent.en;

export const metadata: Metadata = {
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

export default function LandingEN() {
  return <LandingPage content={c} locale="en" />;
}
