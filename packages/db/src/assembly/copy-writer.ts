// P8 (08-06): CopyWriter port selector (CONTEXT A3-Q4); paid AI polish is GO-LIVE.
//
// CDS_COPY_WRITER selects the implementation: unset, "" or "template" gives the free
// deterministic stand-in `templateCopy`; any other value throws, because no other
// implementation exists yet (fail loudly: no silent paid call, no unreviewed writer;
// T-08-06-03). Lives in @cds/db because it reads process.env; @cds/core stays env-free.
import { templateCopy, type CopyWriter } from "@cds/core/templates";

export function getCopyWriter(): CopyWriter {
  const v = process.env.CDS_COPY_WRITER;
  if (v === undefined || v === "" || v === "template") return templateCopy;
  throw new Error(
    `CDS_COPY_WRITER="${v}" has no implementation yet (unset it to use the template stand-in)`,
  );
}
