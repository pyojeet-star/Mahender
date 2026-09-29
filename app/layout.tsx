import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RoomPulse | Live Room Occupancy",
  description: "Monitor doorway crossings and live room occupancy with your webcam.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
