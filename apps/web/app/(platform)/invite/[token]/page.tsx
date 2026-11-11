// /invite/<token> on the platform host (11-38; UI-SPEC "Invite page", D-UI-P11-28,
// T-11-38-05). Centred 400px panel on hub-surface-2 (P3 sign-in frame), no hub chrome, no CDS
// mark. readInvite shows only the org name, inviter, role and invited email. States:
//   unknown token            -> "This invite link doesn't work" (no org name)
//   expired / used / revoked -> INVITE-EXPIRED, no form
//   signed in as the invited email -> Join button
//   signed in as someone else      -> wrong-account note + Sign out (back to this invite)
//   signed out, account exists     -> "Sign in as {email} to accept." + password
//   signed out, no account         -> create account (name + password >= 10)
import { CdsError } from "@cds/core";
import { listMemberOrganizations, readInvite } from "@cds/db";
import { InlineAlert } from "@cds/ui/hub";
import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { sessionCookieName } from "../../../../lib/session";
import { codeSignInHrefFor } from "../../../../lib/sign-in-next";
import { InviteForm } from "./InviteForm";
import { InviteSignOutForm } from "./InviteSignOutForm";

export const metadata: Metadata = {
  title: "Join a site",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer",
  staff: "Staff",
  renter: "Renter",
};

function withArticle(role: string): string {
  return /^[aeiou]/i.test(role) ? `an ${role}` : `a ${role}`;
}

/** The signed-in person's email, or null when signed out (or the session can't be read). */
async function signedInEmail(): Promise<string | null> {
  const token = (await cookies()).get(sessionCookieName())?.value;
  if (!token) return null;
  try {
    const me = await listMemberOrganizations(token);
    return me.email || null;
  } catch (err) {
    if (!(err instanceof CdsError)) {
      console.error(
        "[invite] session lookup failed",
        err instanceof Error ? err.name : typeof err,
      );
    }
    return null;
  }
}

function Frame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-start justify-center bg-hub-surface-2 px-4 py-12 font-hub text-hub-ink sm:items-center">
      <div className="w-full max-w-[400px] rounded-lg border border-hub-border bg-hub-surface p-6">
        <h1 className="mb-4 text-[1.75rem] leading-tight font-semibold text-balance">
          {title}
        </h1>
        <div className="flex flex-col gap-4">{children}</div>
      </div>
    </main>
  );
}

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const info = await readInvite(token).catch((err: unknown) => {
    console.error(
      "[invite] read failed",
      err instanceof Error ? err.name : typeof err,
    );
    return null;
  });

  if (!info) {
    return (
      <Frame title="This invite link doesn't work">
        <p>
          Check that you opened the whole link from the email, or ask the person
          who invited you to send a new one.
        </p>
      </Frame>
    );
  }

  const org = info.orgName;
  const title = `Join ${org}`;
  if (info.expired || info.status !== "pending") {
    return (
      <Frame title={title}>
        <InlineAlert tone="info">
          This invite has expired or was cancelled. Ask {info.inviterName} to
          send a new one.
        </InlineAlert>
        <p className="text-sm text-hub-ink-muted">
          Already joined?{" "}
          <Link
            href="/sign-in"
            className="text-hub-accent underline underline-offset-4"
          >
            Sign in
          </Link>
        </p>
      </Frame>
    );
  }

  const role = ROLE_LABEL[info.role] ?? info.role;
  const intro = (
    <p>
      {info.inviterName} invited you to help with {org}&apos;s website as{" "}
      {withArticle(role)}.
    </p>
  );

  const current = await signedInEmail();
  if (current && current.toLowerCase() !== info.email.toLowerCase()) {
    return (
      <Frame title={title}>
        {intro}
        <InlineAlert tone="info">
          You&apos;re signed in as {current}. This invite is for {info.email}.
          Sign out, then open the invite again.
        </InlineAlert>
        <InviteSignOutForm token={token} />
      </Frame>
    );
  }

  if (current) {
    return (
      <Frame title={title}>
        {intro}
        <p className="text-sm text-hub-ink-muted">
          You&apos;re signed in as {current}.
        </p>
        <InviteForm token={token} mode="join" orgName={org} />
      </Frame>
    );
  }

  if (info.hasAccount) {
    return (
      <Frame title={title}>
        {intro}
        <p>Sign in as {info.email} to accept.</p>
        <InviteForm token={token} mode="signin" orgName={org} />
        {/* WR-E02: owners created at Submit have no password; the code sign-in returns here. */}
        <p className="text-sm text-hub-ink-muted">
          No password?{" "}
          <Link
            href={codeSignInHrefFor(`/invite/${token}`)}
            className="text-hub-accent underline underline-offset-4"
          >
            Sign in with an emailed code
          </Link>
          , then you&apos;ll come back here to join.
        </p>
      </Frame>
    );
  }

  return (
    <Frame title={title}>
      {intro}
      <p className="text-sm text-hub-ink-muted">
        You&apos;ll sign in with {info.email}.
      </p>
      <InviteForm token={token} mode="create" orgName={org} />
    </Frame>
  );
}
