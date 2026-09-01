import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { getSiteUrl } from "@/lib/site-url";

import "./styles.css";

export const metadata: Metadata = {
  metadataBase: getSiteUrl(),
  title: {
    default: "Muse Cam — A camera for impossible worlds",
    template: "%s · Muse Cam",
  },
  description:
    "A physical AI camera powered by Muse Image. Point, shoot, and see the world become something else.",
  openGraph: {
    title: "Muse Cam",
    description: "A camera for impossible worlds.",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f4f0e8",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="page-shell">{children}</div>
      </body>
    </html>
  );
}
