import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PRIZM — Don’t just read code. See it think.",
  description:
    "Turn code into interactive visualizations — step through execution, inspect variables and call stacks, and learn with AI-powered explanations.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
