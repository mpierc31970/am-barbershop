// CdsAuthor, the author chip (12-06 choice 2; 12-UI-SPEC lines 223-226; COMM-05, D83).
// Inline Label: CdsMark 16 + 4px + "Mara" (Label 600 ink) + " · " + "CDS" (Label 600
// --cds-mark). Accessible text "Mara from CDS". System posts (no name) read "CDS" alone.
// Never colour alone: the word "CDS" is always present (T-12-06-02). Chosen server-side by
// author_kind, never by tenant input (T-12-06-01). Tenant authors render as plain names, not
// through this component. Place it inside a [data-cds-identity] container (CdsSurface).
import { CdsMark } from "./CdsMark";

export interface CdsAuthorProps {
  /** Staff first name; blank or absent → "CDS" alone (system posts). */
  firstName?: string;
  className?: string;
}

export function CdsAuthor({ firstName, className }: CdsAuthorProps) {
  const name = firstName?.trim() ?? "";
  return (
    <span
      className={
        "inline-flex items-center gap-1 font-hub text-sm leading-tight font-semibold" +
        (className ? ` ${className}` : "")
      }
    >
      <CdsMark size={16} />
      {name ? (
        <>
          <span aria-hidden="true">
            <span className="text-hub-ink">{name}</span>
            {" · "}
            <span className="text-cds-mark">Support</span>
          </span>
          <span className="sr-only">{`${name} from Support`}</span>
        </>
      ) : (
        <span className="text-cds-mark">Support</span>
      )}
    </span>
  );
}
