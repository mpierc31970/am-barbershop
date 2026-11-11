// TeamSection (08-05; TMPL-01, TMPL-02, D257, D253, D-UI-P8-13, -14, -17;
// 08-UI-SPEC "Our team block"; T-08-05-01, -02, -04).
//
// Members come live from coreData.team (published only, owner order, max 24; 08-08 loader).
// Layouts:
// - One member: profile; photo column 40% (max 400px) beside the text from 768px, photo
//   (max 320px) above the text below that.
// - Two or more: <ul> cards, frame on top, text 16px below. Columns: 2 for 2 members; from
//   1024px 4 for 4, 7 or 8 members, otherwise 3; 640-1023px 2. Below 640px compact rows:
//   96px frame left, name and role right, bio full width under the row.
// Photo states: some photos -> every member gets the 1:1 frame, a missing photo shows the
// initials tile; no photos -> 64px initials circles, no frames (D-UI-P8-13).
// Photo alt is the media description, else "" (the name is the adjacent <h3>; D-UI-P8-14).
// Nothing published -> renders nothing; the builder preview shows an editor-only card.
// React text only; bios keep line breaks via pre-line. --site-* roles only, no accent.
// Server component.
import type { TeamBlockContent } from "@cds/core/content";
import { RowRenderer } from "../RowRenderer";
import {
  BODY_CLASS,
  HEADING_CLASSES,
  type PublicTeamMember,
  type SectionComponentProps,
} from "../types";
import { text } from "../urls";
import { InitialsTile } from "./InitialsTile";
import { EditorEmptyCard } from "./ServicesSection";
import { initialsOf, readTeam } from "./services-team";

const GRID_SIZES = "(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 96px";
const PROFILE_SIZES = "(min-width: 768px) 400px, 320px";

function gridColumns(n: number): string {
  if (n === 2) return "sm:grid-cols-2";
  if (n === 4 || n === 7 || n === 8) return "sm:grid-cols-2 lg:grid-cols-4";
  return "sm:grid-cols-2 lg:grid-cols-3";
}

function Photo({ member, sizes }: { member: PublicTeamMember; sizes: string }) {
  const p = member.photo!;
  return (
    <img
      src={p.src}
      srcSet={p.srcSet}
      sizes={p.srcSet ? sizes : undefined}
      width={p.width}
      height={p.height}
      alt={text(p.alt)}
      decoding="async"
      loading="lazy"
      className="block aspect-square h-auto w-full rounded-site-media object-cover"
    />
  );
}

function MemberText({
  member,
  showRole,
}: {
  member: PublicTeamMember;
  showRole: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h3 className={`${HEADING_CLASSES[3]} text-site-text`}>{member.name}</h3>
      {showRole && member.role ? (
        <p className={`${BODY_CLASS} text-site-text-muted`}>{member.role}</p>
      ) : null}
    </div>
  );
}

function Bio({
  member,
  className = "",
}: {
  member: PublicTeamMember;
  className?: string;
}) {
  return member.bio ? (
    <p
      className={`${BODY_CLASS} whitespace-pre-line text-site-text ${className}`}
    >
      {member.bio}
    </p>
  ) : null;
}

export function TeamSection({
  content,
  layout,
  background,
  coreData,
}: SectionComponentProps<TeamBlockContent>) {
  const c = (content ?? {}) as TeamBlockContent;
  const heading = text(c.heading);
  const members = readTeam(coreData);
  const showRole = c.show_roles !== false;
  const showBio = c.show_bios !== false;

  if (members.length === 0) {
    return coreData?.editorPreview === true ? (
      <EditorEmptyCard
        heading="No team members showing yet"
        body="Add team members in Settings › Team & hours and they show here."
        layout={layout}
        background={background}
      />
    ) : null;
  }

  const anyPhoto = members.some((m) => m.photo);
  let body;

  if (members.length === 1) {
    const m = members[0]!;
    body = (
      <ul>
        <li className="flex flex-col gap-8 md:flex-row md:items-start">
          {anyPhoto ? (
            <div className="w-full max-w-[320px] shrink-0 md:w-2/5 md:max-w-[400px]">
              <Photo member={m} sizes={PROFILE_SIZES} />
            </div>
          ) : (
            <InitialsTile
              initials={initialsOf(m.name)}
              background={background}
              variant="circle"
            />
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <MemberText member={m} showRole={showRole} />
            {showBio ? <Bio member={m} /> : null}
          </div>
        </li>
      </ul>
    );
  } else {
    const rowCols = anyPhoto ? "grid-cols-[96px_1fr]" : "grid-cols-[64px_1fr]";
    body = (
      <ul className={`grid grid-cols-1 gap-8 ${gridColumns(members.length)}`}>
        {members.map((m) => (
          <li
            key={m.id}
            className={`grid ${rowCols} items-start gap-4 sm:flex sm:flex-col`}
          >
            {anyPhoto ? (
              <div className="w-24 sm:w-full">
                {m.photo ? (
                  <Photo member={m} sizes={GRID_SIZES} />
                ) : (
                  <InitialsTile
                    initials={initialsOf(m.name)}
                    background={background}
                    variant="tile"
                  />
                )}
              </div>
            ) : (
              <InitialsTile
                initials={initialsOf(m.name)}
                background={background}
                variant="circle"
              />
            )}
            <MemberText member={m} showRole={showRole} />
            {showBio ? <Bio member={m} className="col-span-2" /> : null}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <RowRenderer layout={layout} background={background}>
      <div className="flex flex-col gap-8">
        {/* A blank heading keeps a hidden h2 so the <h3> names never skip a level (WR-C03). */}
        {heading ? (
          <h2 className={`${HEADING_CLASSES[2]} text-site-text`}>{heading}</h2>
        ) : (
          <h2 className="sr-only">Our team</h2>
        )}
        {body}
      </div>
    </RowRenderer>
  );
}
