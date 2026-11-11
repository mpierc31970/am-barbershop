"use client";
// Settings › Domain › DNS records client islands (14-32 choice 2; 14-UI-SPEC "DNS records";
// D-UI-P14-19, D-UI-P14-20). The toolbar (Add a record, Set up email for my domain), the
// RecordGroupList in manage mode with Change email setup on the Your email header, and the
// three dialogs: AddRecordDialog, RemoveRecordDialog and the Ask to change confirmation (a
// prefilled P12 change ticket). Every write is a POST server action from
// `actions/dns-records.ts`; success refreshes the server view and shows a Toast. Never imports
// @cds/db (browser boundary): rows arrive already built (records-view.ts on the server).
import { P14_COPY } from "@cds/core/dns";
import {
  Button,
  Dialog,
  InlineAlert,
  buttonClasses,
  useToast,
} from "@cds/ui/hub";
import {
  AddRecordDialog,
  EmailSetupFlow,
  RecordGroupList,
  RemoveRecordDialog,
  displayRecordName,
  type DomainRecordRow,
  type EmailSetupChoice,
  type RecordGroup,
} from "@cds/ui/hub/domain";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  addRecordAction,
  applyEmailSetupAction,
  askEmailSetupAction,
  askToChangeAction,
  emailSetupPreviewAction,
  removeRecordAction,
} from "../../../actions/dns-records";

export const DNS_CONTROLS_COPY = Object.freeze({
  askTitle: "Ask Support to change this record?",
  askBody:
    "Support gets a change request with this record. You can follow it in Support.",
  sending: "Sending…",
  asked: (n: number) => `Sent to Support as request #${n}.`,
});

const C = DNS_CONTROLS_COPY;

export function RecordsManager({
  domain,
  groups,
  canEdit,
  emailHref,
}: {
  domain: string;
  groups: readonly RecordGroup[];
  canEdit: boolean;
  emailHref: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<DomainRecordRow | null>(null);
  const [asking, setAsking] = useState<DomainRecordRow | null>(null);
  const [askPending, setAskPending] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);

  const withHeader: RecordGroup[] = groups.map((g) =>
    g.key === "email" && canEdit
      ? {
          ...g,
          headerAction: (
            <Link href={emailHref} className={buttonClasses("ghost", "sm")}>
              {P14_COPY.BTN_CHANGE_EMAIL_SETUP}
            </Link>
          ),
        }
      : g,
  );

  async function sendAsk() {
    if (!asking || askPending) return;
    setAskPending(true);
    try {
      const res = await askToChangeAction({
        type: asking.type,
        name: displayRecordName(asking.name, domain),
        value: asking.value,
      });
      if (res.ok) {
        setAsking(null);
        setAskError(null);
        toast.show({ message: C.asked(res.data.number) });
      } else {
        setAskError(res.message);
      }
    } catch {
      setAskError(P14_COPY.ERR_GENERIC);
    } finally {
      setAskPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {canEdit ? (
        <div
          data-records-toolbar=""
          className="flex flex-col gap-3 sm:flex-row sm:flex-wrap"
        >
          <Button
            type="button"
            variant="secondary"
            icon={<Plus aria-hidden size={16} />}
            onClick={() => setAdding(true)}
            className="w-full sm:w-auto"
          >
            {P14_COPY.BTN_ADD_A_RECORD}
          </Button>
          <Link
            href={emailHref}
            className={`${buttonClasses("secondary", "md")} w-full sm:w-auto`}
          >
            {P14_COPY.BTN_SET_UP_EMAIL}
          </Link>
        </div>
      ) : null}
      <RecordGroupList
        mode="manage"
        groups={withHeader}
        domain={domain}
        readOnly={!canEdit}
        onRemove={(row) => setRemoving(row)}
        onAskChange={(row) => {
          setAskError(null);
          setAsking(row);
        }}
      />
      {canEdit ? (
        <>
          <AddRecordDialog
            open={adding}
            onClose={() => setAdding(false)}
            domain={domain}
            action={addRecordAction}
            onAdded={(message) => {
              toast.show({ message });
              router.refresh();
            }}
          />
          <RemoveRecordDialog
            open={removing !== null}
            onClose={() => setRemoving(null)}
            domain={domain}
            record={removing}
            action={() =>
              removing
                ? removeRecordAction(removing.key)
                : Promise.resolve({
                    ok: false as const,
                    code: "invalid_input",
                    message: "",
                  })
            }
            onRemoved={(message) => {
              toast.show({ message });
              router.refresh();
            }}
          />
          <Dialog
            open={asking !== null}
            onClose={() => setAsking(null)}
            title={C.askTitle}
            footer={
              <>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setAsking(null)}
                >
                  {P14_COPY.BTN_DONT_SEND}
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  loading={askPending}
                  loadingLabel={C.sending}
                  onClick={() => void sendAsk()}
                >
                  {P14_COPY.BTN_SEND_TO_CDS}
                </Button>
              </>
            }
          >
            <div className="flex flex-col gap-4">
              <p>{C.askBody}</p>
              {asking ? (
                <p className="flex flex-col gap-1 rounded bg-hub-surface-2 p-3 font-mono text-sm [overflow-wrap:anywhere]">
                  <span>
                    {asking.type} {displayRecordName(asking.name, domain)}
                  </span>
                  <span className="text-hub-ink-muted">{asking.value}</span>
                </p>
              ) : null}
              {askError ? (
                <InlineAlert tone="error">{askError}</InlineAlert>
              ) : null}
            </div>
          </Dialog>
        </>
      ) : null}
    </div>
  );
}

/** Settings › Domain › email setup: the 3-step flow wired to the server actions. */
export function EmailSetupIsland({
  domain,
  currentPreset,
  recordsHref,
  howToHref,
}: {
  domain: string;
  currentPreset: Exclude<EmailSetupChoice, "other"> | null;
  recordsHref: string;
  howToHref: string | null;
}) {
  return (
    <EmailSetupFlow
      domain={domain}
      currentPreset={currentPreset}
      previewAction={emailSetupPreviewAction}
      applyAction={applyEmailSetupAction}
      askAction={askEmailSetupAction}
      recordsHref={recordsHref}
      howToHref={howToHref}
    />
  );
}
