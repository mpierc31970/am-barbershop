// /hub/studio-booking/services: one barber's services and prices (A&M fork: its own tab,
// after Bookings). A barber edits their own; the owner picks a barber (?seat=).
import { Button, TextField } from "@cds/ui/hub";
import type { Metadata } from "next";
import {
  removeServiceAction,
  saveServiceAction,
} from "../../../../actions/studio";
import { duration, money, priceField } from "../../../../../lib/studio";
import { SeatTabFrame, seatForTab } from "../SeatTabFrame";

export const metadata: Metadata = { title: "Services & Pricing" };
export const dynamic = "force-dynamic";

const CARD =
  "flex flex-col gap-4 rounded border border-hub-border bg-hub-surface p-4";

type Props = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ServicesPage({ searchParams }: Props) {
  const { seat, manager, seats } = await seatForTab(searchParams);
  return (
    <SeatTabFrame
      title="Services & Pricing"
      tab="services"
      path="/services"
      seat={seat}
      manager={manager}
      seats={seats}
    >
      <section aria-label="Services" className="flex flex-col gap-3">
        {seat.services.map((s) => (
          <form
            key={s.id}
            action={saveServiceAction}
            className={`${CARD} sm:grid sm:grid-cols-[2fr_1fr_1fr]`}
          >
            <input type="hidden" name="seatId" value={seat.id} />
            <input type="hidden" name="serviceId" value={s.id} />
            <TextField
              id={`n-${s.id}`}
              name="name"
              label="Service"
              defaultValue={s.name}
              required
              maxLength={80}
            />
            <TextField
              id={`d-${s.id}`}
              name="duration"
              label="Minutes"
              type="number"
              min={5}
              max={480}
              step={5}
              defaultValue={s.durationMinutes}
              required
            />
            <TextField
              id={`p-${s.id}`}
              name="price"
              label="Price ($)"
              inputMode="decimal"
              defaultValue={priceField(s.priceCents)}
              helper="Blank: ask for a price"
            />
            <div className="sm:col-span-3">
              <TextField
                id={`x-${s.id}`}
                name="description"
                label="Description"
                defaultValue={s.description}
                maxLength={300}
              />
            </div>
            <div className="flex gap-2 sm:col-span-3">
              <Button type="submit" size="sm">
                Save
              </Button>
              <Button
                type="submit"
                size="sm"
                variant="ghost"
                formAction={removeServiceAction}
              >
                Remove
              </Button>
              <span className="self-center text-sm text-hub-ink-muted">
                {duration(s.durationMinutes)} · {money(s.priceCents)}
              </span>
            </div>
          </form>
        ))}
        <form
          action={saveServiceAction}
          className={`${CARD} sm:grid sm:grid-cols-[2fr_1fr_1fr]`}
        >
          <input type="hidden" name="seatId" value={seat.id} />
          <TextField
            id="n-new"
            name="name"
            label="New service"
            required
            maxLength={80}
          />
          <TextField
            id="d-new"
            name="duration"
            label="Minutes"
            type="number"
            min={5}
            max={480}
            step={5}
            defaultValue={30}
            required
          />
          <TextField
            id="p-new"
            name="price"
            label="Price ($)"
            inputMode="decimal"
            helper="Blank: ask for a price"
          />
          <div className="sm:col-span-3">
            <TextField
              id="x-new"
              name="description"
              label="Description"
              maxLength={300}
            />
          </div>
          <div>
            <Button type="submit" size="sm" variant="primary">
              Add service
            </Button>
          </div>
        </form>
      </section>
    </SeatTabFrame>
  );
}
