// The Studio Booking tab bar. The owner (and Admins): Barbers, Social, Bookings, Services &
// Pricing, Rent. A barber: My page, My Social, My bookings, Services & Pricing, My Rent, all
// for their own seat. Each tab is its own route.
import { TabLinks } from "@cds/ui/hub";
import { STUDIO_BASE } from "../../../../lib/studio";

export type StudioTab = "barbers" | "social" | "bookings" | "services" | "rent";

export function StudioTabs({
  active,
  manager,
}: {
  active: StudioTab;
  manager: boolean;
}) {
  const tabs = [
    {
      id: "barbers",
      label: manager ? "Barbers" : "My page",
      href: STUDIO_BASE,
    },
    {
      id: "social",
      label: manager ? "Social" : "My Social",
      href: `${STUDIO_BASE}/social`,
    },
    {
      id: "bookings",
      label: manager ? "Bookings" : "My bookings",
      href: `${STUDIO_BASE}/bookings`,
    },
    {
      id: "services",
      label: "Services & Pricing",
      href: `${STUDIO_BASE}/services`,
    },
    {
      id: "rent",
      label: manager ? "Rent" : "My Rent",
      href: `${STUDIO_BASE}/rent`,
    },
  ];
  return <TabLinks tabs={tabs} activeId={active} label="Studio Booking" />;
}
