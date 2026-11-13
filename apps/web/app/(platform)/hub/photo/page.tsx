// A&M fork: "Take a photo" from the profile menu. A visible camera button (a <label> around
// the file input, so iPhone opens the camera natively, no scripted click) posts the photo
// to the barber's own gallery through /hub/api/studio/photo.
import { mySeatId } from "@cds/db";
import { InlineAlert } from "@cds/ui/hub";
import { ScreenHeader } from "@cds/ui/hub/shell";
import type { Metadata } from "next";
import { requireHubSession } from "../../../../lib/session";
import { GuardedLink } from "../GuardedLink";
import { PhotoPicker } from "./PhotoPicker";

export const metadata: Metadata = { title: "Take a photo" };

export default async function PhotoPage() {
  const { ctx } = await requireHubSession();
  const seatId = await mySeatId(ctx).catch(() => null);
  return (
    <div className="flex w-full max-w-[560px] flex-col gap-6 font-hub text-hub-ink">
      <ScreenHeader
        title="Take a photo"
        helpId="phone-app"
        LinkComponent={GuardedLink}
      />
      {seatId ? (
        <>
          <p className="text-base">
            The photo goes into your gallery on your barber page.
          </p>
          <PhotoPicker seatId={seatId} />
        </>
      ) : (
        <InlineAlert tone="info">
          Photos go into a barber&apos;s own gallery. This account has no barber
          page.
        </InlineAlert>
      )}
    </div>
  );
}
