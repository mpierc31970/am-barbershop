// Settings loading state (06-UI-SPEC "Settings": skeleton fields; "Interaction states"). The
// H1 stays put; field rows at the real 40px control height, no spinner.
import { Skeleton } from "@cds/ui/hub";

export default function SettingsLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <h1 className="text-[1.75rem] leading-tight font-semibold text-hub-ink">
        Settings
      </h1>
      <Skeleton rows={6} rowHeight={40} />
    </div>
  );
}
