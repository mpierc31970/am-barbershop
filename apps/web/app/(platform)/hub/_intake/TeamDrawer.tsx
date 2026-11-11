"use client";
// Team member drawer (06-20; 06-UI-SPEC "Team"; ONB-04, ONB-13, D257, D280). Right Drawer,
// 480px: Name (required), Role or title, Bio (600, counter), Photo (ImageUpload kind team,
// description suggested "Photo of {name}"), Show on site. Save team member (disabled until
// something changed), Discard changes when dirty, and a leave guard on a dirty close. The
// chokepoint repeats every check (validateTeamMember, the photo must be the tenant's own team
// photo), so the client checks are a courtesy. Removing the photo here only unlinks it (the
// upload stays in the media library) and is saved with the member.
import {
  Badge,
  Button,
  Dialog,
  Drawer,
  IconButton,
  ImageUpload,
  InlineAlert,
  Switch,
  TextArea,
  TextField,
  type MediaAssetView,
} from "@cds/ui/hub";
import { X } from "lucide-react";
import { useId, useRef, useState } from "react";
import type { TeamMemberView } from "../../../../lib/intake";
import { saveTeamMemberAction } from "../../../actions/core-lists";
import { setMediaAltAction } from "../../../actions/media";

export const TEAM_DRAWER = {
  newTitle: "Add a team member",
  editTitle: (name: string) => `Edit ${name}`,
  close: "Close",
  name: "Name",
  nameEmpty: "Add a name.",
  role: "Role or title",
  roleHelper: "Like 'Owner' or 'Senior stylist'",
  bio: "Bio",
  photo: "Photo",
  photoHelper: "Leave empty and we'll show their initials.",
  showOnSite: "Show on site",
  save: "Save team member",
  saving: "Saving…",
  discard: "Discard changes",
  failed:
    "Your changes weren't saved. Try again; if it keeps failing, copy your text somewhere safe first.",
  guardTitle: "Save changes to this team member?",
  guardBody: "You have changes that aren't saved yet.",
  guardSave: "Save and close",
  guardKeep: "Keep editing",
} as const;

export const BIO_MAX = 600;
const NAME_MAX = 80;
const ROLE_MAX = 80;

type Form = {
  name: string;
  role: string;
  bio: string;
  photo: MediaAssetView | null;
  is_published: boolean;
};

function formOf(m: TeamMemberView | null): Form {
  return {
    name: m?.name ?? "",
    role: m?.role ?? "",
    bio: m?.bio ?? "",
    photo: m?.photo ?? null,
    is_published: m ? m.is_published : true,
  };
}

const key = (f: Form) =>
  JSON.stringify({ ...f, photo: f.photo ? f.photo.id : null });

export interface TeamDrawerProps {
  /** null while adding. */
  member: TeamMemberView | null;
  /** `held` = the publish scan held it, so it was saved hidden (13-52, D270). */
  onSaved: (member: TeamMemberView, held: boolean) => void;
  onClose: () => void;
}

export function TeamDrawer({ member, onSaved, onClose }: TeamDrawerProps) {
  const uid = useId();
  const initial = useRef(formOf(member)).current;
  const [form, setForm] = useState<Form>(initial);
  const [nameError, setNameError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [guard, setGuard] = useState(false);
  const unlinked = useRef<MediaAssetView | null>(null);

  const dirty = key(form) !== key(initial);
  const id = (k: string) => `${uid}-${k}`;
  const title = member
    ? TEAM_DRAWER.editTitle(member.name)
    : TEAM_DRAWER.newTitle;

  function set<K extends keyof Form>(k: K, v: Form[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save(): Promise<void> {
    const name = form.name.trim();
    if (name === "") {
      setNameError(TEAM_DRAWER.nameEmpty);
      document.getElementById(id("name"))?.focus();
      return;
    }
    setSaving(true);
    setFailure(null);
    const res = await saveTeamMemberAction(
      {
        name,
        role: form.role.trim(),
        bio: form.bio.trim(),
        is_published: form.is_published,
        photoId: form.photo ? form.photo.id : null,
      },
      member?.id,
    ).catch(() => null);
    setSaving(false);
    if (!res) {
      setFailure(TEAM_DRAWER.failed);
      return;
    }
    if (!res.ok) {
      setFailure(res.message || TEAM_DRAWER.failed);
      return;
    }
    onSaved(
      {
        id: res.data.id,
        name: res.data.name,
        role: res.data.role,
        bio: res.data.bio,
        is_published: res.data.is_published,
        photo: res.data.photoId ? form.photo : null,
      },
      res.data.held === true,
    );
  }

  function requestClose() {
    if (saving) return;
    if (dirty) setGuard(true);
    else onClose();
  }

  return (
    <>
      <Drawer open onClose={requestClose} label={title} side="right">
        <div className="flex min-h-full flex-col font-hub text-hub-ink">
          <div className="flex items-center justify-between gap-2 border-b border-hub-border px-6 py-4">
            <h2 className="text-xl leading-tight font-semibold">{title}</h2>
            <IconButton
              label={TEAM_DRAWER.close}
              tooltipAlign="end"
              onClick={requestClose}
              icon={<X aria-hidden size={20} strokeWidth={2} />}
            />
          </div>
          <div className="flex flex-1 flex-col gap-6 px-6 py-6">
            <TextField
              id={id("name")}
              label={TEAM_DRAWER.name}
              required
              maxLength={NAME_MAX}
              value={form.name}
              error={nameError ?? undefined}
              onChange={(e) => {
                set("name", e.target.value);
                if (nameError && e.target.value.trim()) setNameError(null);
              }}
            />
            <TextField
              id={id("role")}
              label={TEAM_DRAWER.role}
              labelExtra={<Badge tone="optional">Optional</Badge>}
              helper={TEAM_DRAWER.roleHelper}
              maxLength={ROLE_MAX}
              value={form.role}
              onChange={(e) => set("role", e.target.value)}
            />
            <TextArea
              id={id("bio")}
              label={TEAM_DRAWER.bio}
              labelExtra={<Badge tone="optional">Optional</Badge>}
              rows={4}
              value={form.bio}
              counter={{ value: form.bio.length, max: BIO_MAX }}
              error={
                form.bio.trim().length > BIO_MAX
                  ? `The bio is longer than ${BIO_MAX} characters.`
                  : undefined
              }
              onChange={(e) => set("bio", e.target.value)}
            />
            <ImageUpload
              id={id("photo")}
              kind="team"
              label={TEAM_DRAWER.photo}
              labelExtra={<Badge tone="optional">Optional</Badge>}
              helper={TEAM_DRAWER.photoHelper}
              value={form.photo ? [form.photo] : []}
              suggestedAlt={
                form.name.trim() ? `Photo of ${form.name.trim()}` : ""
              }
              altRequired
              onUploaded={(asset) => set("photo", asset)}
              onAltChange={(photoId, alt) =>
                setMediaAltAction(photoId, alt).then(
                  (r) => {
                    if (!r.ok) setFailure(r.message);
                    return r.ok;
                  },
                  () => false,
                )
              }
              onRemove={() => {
                unlinked.current = form.photo;
                set("photo", null);
              }}
              onRestore={() => {
                if (unlinked.current) set("photo", unlinked.current);
              }}
            />
            <Switch
              id={id("shown")}
              label={TEAM_DRAWER.showOnSite}
              checked={form.is_published}
              onChange={(v) => set("is_published", v)}
            />
          </div>
          <div className="sticky bottom-0 flex flex-col gap-3 border-t border-hub-border bg-hub-surface px-6 py-4">
            {failure ? <InlineAlert tone="error">{failure}</InlineAlert> : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                disabled={!dirty}
                loading={saving}
                loadingLabel={TEAM_DRAWER.saving}
                onClick={() => void save()}
              >
                {TEAM_DRAWER.save}
              </Button>
              {dirty ? (
                <Button
                  variant="ghost"
                  disabled={saving}
                  onClick={() => {
                    setForm(initial);
                    setNameError(null);
                    setFailure(null);
                  }}
                >
                  {TEAM_DRAWER.discard}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </Drawer>
      <Dialog
        open={guard}
        onClose={() => setGuard(false)}
        title={TEAM_DRAWER.guardTitle}
        footer={
          <>
            <Button
              variant="primary"
              onClick={() => {
                setGuard(false);
                void save();
              }}
            >
              {TEAM_DRAWER.guardSave}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setGuard(false);
                onClose();
              }}
            >
              {TEAM_DRAWER.discard}
            </Button>
            <Button variant="ghost" autoFocus onClick={() => setGuard(false)}>
              {TEAM_DRAWER.guardKeep}
            </Button>
          </>
        }
      >
        <p>{TEAM_DRAWER.guardBody}</p>
      </Dialog>
    </>
  );
}
