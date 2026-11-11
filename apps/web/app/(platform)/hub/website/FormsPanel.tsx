"use client";
// Website › Forms client panel (07-18; CONT-25, D231, D270, D275, D311; 07-UI-SPEC "Forms").
// Wires the forms actions into the @cds/ui/hub forms components: the list with the template
// chooser beside it (two panes from 1024px, D311), and the three-pane editor at full width
// (its list | settings | preview panes need the room, D-UI-P7-32). Navigation is
// router.replace on /hub/website?tab=forms…, asked through the hub nav guard so unsaved edits
// get the leave dialog; beforeunload covers tab closes (PopupEditor pattern). Delete asks
// formUsedOnAction first to choose the dialog copy (choice 5; Keep form autofocused). The
// how-to button and the health tip open TrainingDrawers with the baked how-to steps.
import {
  Button,
  DELETE_FORM_COPY,
  Dialog,
  FORM_CREATED_TOAST,
  FORM_DELETED_TOAST,
  FORM_DUPLICATED_TOAST,
  FORM_GONE_COPY,
  FormEditor,
  FormsList,
  InlineAlert,
  TemplateChooser,
  TrainingDrawer,
  formsHref,
  useToast,
  type EmailRouteView,
  type FormDraft,
  type FormRowView,
} from "@cds/ui/hub";
import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createFormAction,
  deleteFormAction,
  duplicateFormAction,
  formUsedOnAction,
  saveFormAction,
} from "../../../actions/forms";
import { GuardedLink } from "../GuardedLink";
import { useNavGuard, useRegisterNavGuard } from "../nav-guard";
import {
  EXTERNAL_FORM_STEPS,
  EXTERNAL_FORM_TITLE,
  FORMS_STEPS,
  FORMS_TITLE,
} from "./forms-steps";

export type FormsPanelEditor = {
  form: FormDraft & { id: string };
  pages: { id: string; title: string }[];
  routes: EmailRouteView[] | null;
  theme: { hash: string; css: string };
  /** Entitlement keys from getEntitlements (server, 10-17); a Set is built client-side. */
  entitlements: string[];
  /** purchases:run: the owner sees "Add Builder Pro", others "Ask your site owner". */
  canBuy: boolean;
};

export interface FormsPanelProps {
  forms: FormRowView[];
  canWrite: boolean;
  creating: boolean;
  editor: FormsPanelEditor | null;
  gone: boolean;
}

const BACK_LINK =
  "inline-flex w-fit items-center gap-1 rounded text-sm font-semibold text-hub-ink-muted hover:text-hub-ink";

export function FormsPanel({
  forms,
  canWrite,
  creating,
  editor,
  gone,
}: FormsPanelProps) {
  const router = useRouter();
  const toast = useToast();
  const navGuard = useNavGuard();
  const [howTo, setHowTo] = useState(false);
  const [external, setExternal] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<{
    id: string;
    name: string;
    used: boolean;
  } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [pendingNav, setPendingNav] = useState<{ run: () => void } | null>(
    null,
  );
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  useRegisterNavGuard((go) => {
    if (!dirtyRef.current) return false;
    setPendingNav({ run: go });
    return true;
  });

  const navigate = useCallback(
    (href: string, refresh = false) => {
      const go = () => {
        router.replace(href, { scroll: false });
        if (refresh) router.refresh();
      };
      if (!navGuard.intercept(go)) go();
    },
    [navGuard, router],
  );

  async function create(template: string) {
    setPending(true);
    setError(null);
    const res = await createFormAction({ template });
    setPending(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    toast.show({ message: FORM_CREATED_TOAST });
    navigate(formsHref(res.data.id), true);
  }

  async function duplicate(id: string) {
    setError(null);
    const res = await duplicateFormAction(id);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    toast.show({ message: FORM_DUPLICATED_TOAST });
    navigate(formsHref(res.data.id), true);
  }

  async function askDelete(id: string) {
    setError(null);
    const name = forms.find((f) => f.id === id)?.name ?? "";
    const res = await formUsedOnAction(id);
    const used = res.ok
      ? res.data.pages.length > 0 ||
        res.data.inVersions ||
        res.data.inPopups > 0
      : true;
    setDeleting({ id, name, used });
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    const res = await deleteFormAction(deleting.id);
    setDeleteBusy(false);
    setDeleting(null);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    toast.show({ message: FORM_DELETED_TOAST });
    navigate(formsHref(), true);
  }

  const onSave = useCallback(
    async (input: Parameters<typeof saveFormAction>[0]) => {
      const res = await saveFormAction(input);
      if (res.ok && "saved" in res.data) router.refresh();
      return res;
    },
    [router],
  );

  const list = (
    <FormsList
      forms={forms}
      canWrite={canWrite}
      selectedId={creating ? null : (editor?.form.id ?? null)}
      onOpen={(id) => navigate(formsHref(id))}
      onCreate={() => navigate(formsHref("new"))}
      onDuplicate={(id) => void duplicate(id)}
      onDelete={(id) => void askDelete(id)}
      onHowTo={() => setHowTo(true)}
      LinkComponent={GuardedLink}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      {gone ? <InlineAlert tone="info">{FORM_GONE_COPY}</InlineAlert> : null}
      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      {editor ? (
        <FormEditor
          key={editor.form.id}
          form={editor.form}
          theme={editor.theme}
          pages={editor.pages}
          routes={editor.routes}
          readOnly={!canWrite}
          onSave={onSave}
          onDirtyChange={setDirty}
          onExternalFormHelp={() => setExternal(true)}
          LinkComponent={GuardedLink}
          backHref={formsHref()}
          entitlements={new Set(editor.entitlements)}
          canBuy={editor.canBuy}
        />
      ) : (
        <div className="grid gap-8 lg:grid-cols-[360px_minmax(0,1fr)] lg:items-start">
          <div className={creating ? "hidden lg:block" : undefined}>{list}</div>
          <div className={creating ? undefined : "hidden lg:block"}>
            {creating ? (
              <div className="flex flex-col gap-4">
                <GuardedLink
                  href={formsHref()}
                  className={`${BACK_LINK} lg:hidden`}
                >
                  <ChevronLeft aria-hidden size={16} strokeWidth={2} />
                  Forms
                </GuardedLink>
                <TemplateChooser
                  pending={pending}
                  onCreate={(t) => void create(t)}
                  onBack={() => navigate(formsHref())}
                />
              </div>
            ) : forms.length > 0 ? (
              <p className="rounded border border-dashed border-hub-border px-6 py-12 text-base text-hub-ink-muted">
                Choose a form to edit it, or create a new one.
              </p>
            ) : null}
          </div>
        </div>
      )}

      {deleting ? (
        <Dialog
          open
          onClose={() => setDeleting(null)}
          title={DELETE_FORM_COPY.title(deleting.name)}
          footer={
            <>
              <Button autoFocus onClick={() => setDeleting(null)}>
                {DELETE_FORM_COPY.keep}
              </Button>
              <Button
                variant="destructive"
                loading={deleteBusy}
                loadingLabel="Deleting…"
                onClick={() => void confirmDelete()}
              >
                {DELETE_FORM_COPY.confirm}
              </Button>
            </>
          }
        >
          {deleting.used ? DELETE_FORM_COPY.used : DELETE_FORM_COPY.unused}
        </Dialog>
      ) : null}

      {pendingNav ? (
        <Dialog
          open
          onClose={() => setPendingNav(null)}
          title="Leave without saving this form?"
          footer={
            <>
              <Button autoFocus onClick={() => setPendingNav(null)}>
                Keep editing
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  const go = pendingNav.run;
                  dirtyRef.current = false;
                  setDirty(false);
                  setPendingNav(null);
                  go();
                }}
              >
                Discard changes
              </Button>
            </>
          }
        >
          You changed this form but haven&apos;t saved it. Keep editing, then
          click Save form.
        </Dialog>
      ) : null}

      <TrainingDrawer
        open={howTo}
        onClose={() => setHowTo(false)}
        title={FORMS_TITLE}
        steps={FORMS_STEPS}
      />
      <TrainingDrawer
        open={external}
        onClose={() => setExternal(false)}
        title={EXTERNAL_FORM_TITLE}
        steps={EXTERNAL_FORM_STEPS}
      />
    </div>
  );
}
