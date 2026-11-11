// /hub/studio-booking/social: one barber's social links (A&M fork: its own tab, "My Social",
// after My page). A barber edits their own; the owner picks a barber (?seat=). The links
// show on that barber's public page only.
import { SEAT_SOCIALS, socialName } from "@cds/db";
import { Button, TextField } from "@cds/ui/hub";
import type { Metadata } from "next";
import { saveSocialAction } from "../../../../actions/studio";
import { SeatTabFrame, seatForTab } from "../SeatTabFrame";

export const metadata: Metadata = { title: "My Social" };
export const dynamic = "force-dynamic";

type Props = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SocialPage({ searchParams }: Props) {
  const { seat, manager, seats } = await seatForTab(searchParams);
  return (
    <SeatTabFrame
      title={manager ? "Social" : "My Social"}
      tab="social"
      path="/social"
      seat={seat}
      manager={manager}
      seats={seats}
    >
      <form
        action={saveSocialAction}
        className="flex flex-col gap-4 rounded border border-hub-border bg-hub-surface p-4"
      >
        <input type="hidden" name="seatId" value={seat.id} />
        <p className="text-sm text-hub-ink-muted">
          A link or an @handle for each. Leave one blank to hide it. These show
          on your page only.
        </p>
        {SEAT_SOCIALS.map((p) => (
          <TextField
            key={p}
            id={`s-social-${p}`}
            name={`social_${p}`}
            label={socialName(p)}
            defaultValue={seat.socials.find((s) => s.platform === p)?.url ?? ""}
            maxLength={300}
          />
        ))}
        <div>
          <Button type="submit" variant="primary">
            Save social links
          </Button>
        </div>
      </form>
    </SeatTabFrame>
  );
}
