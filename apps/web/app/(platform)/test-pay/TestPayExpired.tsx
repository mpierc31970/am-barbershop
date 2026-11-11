// The test pages' expired state (10-23 choice 2; UI-SPEC error row "Test pages"): an
// unknown, settled, malformed or other-org id shows this and Back to CDS, no action buttons.
import { InlineAlert, buttonClasses } from "@cds/ui/hub";
import { TEST_PAY_EXPIRED, TEST_PAY_HOME } from "../../../lib/test-pay";

export function TestPayExpired({ title }: { title: string }) {
  return (
    <>
      <h1 className="text-2xl leading-tight font-semibold text-hub-ink">
        {title}
      </h1>
      <InlineAlert tone="warning">{TEST_PAY_EXPIRED}</InlineAlert>
      <a href={TEST_PAY_HOME} className={buttonClasses("ghost")}>
        Back to the hub
      </a>
    </>
  );
}
