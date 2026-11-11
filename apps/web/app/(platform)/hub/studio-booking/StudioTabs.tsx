// The Studio Booking tab bar (owner and admin). Each tab is its own route.
import { TabLinks } from "@cds/ui/hub";
import { STUDIO_BASE } from "../../../../lib/studio";

const TABS = [{ id: "barbers", label: "Barbers", href: STUDIO_BASE }] as const;

export function StudioTabs({
  active,
}: {
  active: (typeof TABS)[number]["id"];
}) {
  return <TabLinks tabs={TABS} activeId={active} label="Studio Booking" />;
}
