// "./admin": the Website → Testimonials tab panel and the block form (ADDON-02). Client
// modules: the hub imports them through @cds/addon-registry/admin.
import { BlockForm } from "./BlockForm";
import { TestimonialsPanel } from "./TestimonialsPanel";

export const Panel = TestimonialsPanel;
export const blockForms = { testimonials: BlockForm };
