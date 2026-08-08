import type { ReactNode } from "react";

export const metadata = {
  title: "Fantasy Draft Machine",
  description: "Real-time multiplayer fantasy football draft room",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
