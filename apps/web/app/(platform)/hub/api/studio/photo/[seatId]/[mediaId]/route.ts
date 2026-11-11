// GET /hub/api/studio/photo/<seatId>/<mediaId>: the hub preview of one of the seat's own
// photos (readSeatPhoto: a barber only their own seat). Every refusal is 404.
import { readSeatPhoto } from "@cds/db";
import { getHubSession } from "../../../../../../../../lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ seatId: string; mediaId: string }> };

export async function GET(req: Request, { params }: Params): Promise<Response> {
  const session = await getHubSession();
  const { seatId, mediaId } = await params;
  if (!session) return new Response(null, { status: 404 });
  const variant =
    new URL(req.url).searchParams.get("v") === "web" ? "web" : "thumb";
  try {
    const { bytes, mime } = await readSeatPhoto(
      session.ctx,
      seatId,
      mediaId,
      variant,
    );
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": mime,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch {
    return new Response(null, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
