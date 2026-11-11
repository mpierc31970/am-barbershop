// "./admin": the Website → Credentials tab panel and the block form (ADDON-02). Client
// modules: the hub imports them through @cds/addon-registry/admin.
import { BlockForm } from "./BlockForm";
import { CredentialsPanel } from "./CredentialsPanel";

export const Panel = CredentialsPanel;
export const blockForms = { credentials: BlockForm };
