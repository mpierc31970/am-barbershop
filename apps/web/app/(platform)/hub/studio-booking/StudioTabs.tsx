// The Studio Booking tab bar. The owner (and Admins): Barbers, Bookings. A barber: their own
// page and their own bookings. Each tab is its own route.
import { TabLinks } from "@cds/ui/hub";
import { STUDIO_BASE } from "../../../../lib/studio";

export type StudioTab = "barbers" | "bookings";

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
      id: "bookings",
      label: manager ? "Bookings" : "My bookings",
      href: `${STUDIO_BASE}/bookings`,
    },
  ];
  return <TabLinks tabs={tabs} activeId={active} label="Studio Booking" />;
}
