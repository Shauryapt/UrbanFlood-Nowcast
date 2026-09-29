import type { Metadata } from "next";
import { Archivo, Archivo_Narrow, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const body = Archivo({ variable: "--font-body", subsets: ["latin"] });
const cond = Archivo_Narrow({ variable: "--font-cond", subsets: ["latin"], weight: ["500", "600", "700"] });
const data = IBM_Plex_Mono({ variable: "--font-data", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "UrbanFlood Nowcast",
  description: "Urban Flood Intelligence & 0–3 Hour Nowcasting",
};

// Apply the stored theme before first paint (dark is the default).
const THEME_SCRIPT = `try{if(localStorage.getItem("ufn-theme")==="light")document.documentElement.dataset.theme="light"}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${body.variable} ${cond.variable} ${data.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
