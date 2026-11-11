// A&M fork: the sign-in frame for /sign-in and /staff/sign-in. The site's night look (the
// .am-signin tokens in am-signin.css), the logo linking home, a centred 400px card, and a way
// back to the site. Server component.
import type { ReactNode } from "react";
import "./am-signin.css";

export function AmSignInFrame({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <main className="am-signin flex min-h-dvh flex-col items-center justify-start gap-8 bg-hub-surface-2 px-4 py-12 font-hub text-hub-ink sm:justify-center">
      {/* A full page load: "/" is the public site, not this route group. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a
        href="/"
        className="block rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-hub-accent"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/am-barber/logo.png"
          alt="A&M Barber Studio, back to the site"
          width={647}
          height={472}
          className="h-auto w-[180px]"
        />
      </a>
      <div className="w-full max-w-[400px] border border-hub-border bg-hub-surface p-6">
        <h1 className="mb-6 text-[1.75rem] leading-tight">{title}</h1>
        {children}
      </div>
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/" className="text-sm underline underline-offset-4">
        Back to the site
      </a>
    </main>
  );
}
