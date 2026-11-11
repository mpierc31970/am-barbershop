"use client";
// Form options for every Form item editor (07-18 choice 3; CONT-25, D119). The page builder
// (Builder.tsx) and the pop-up editor (PopupEditor.tsx) each wrap their tree once in
// FormOptionsProvider; slides, tab panels and pop-ups inherit it with no prop threading
// (never add `forms` to CoreBlockEditorProps or SectionForm). createForm calls the given
// server action, appends the new { id, name } option and resolves it, so the item can select
// the new form at once. No fetching here and no next/*: the action arrives as a prop.
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { HubActionResult } from "../../hub/addon-types";
import type { FormOption } from "./types";

export type CreateFormOutcome =
  { ok: true; option: FormOption } | { ok: false; message: string };

export interface FormOptionsContextValue {
  forms: readonly FormOption[];
  createForm: (template: string) => Promise<CreateFormOutcome>;
}

export interface FormOptionsProviderProps {
  forms: readonly FormOption[];
  createForm: (input: {
    template: string;
  }) => Promise<HubActionResult<{ id: string; name: string }>>;
  children?: ReactNode;
}

const FALLBACK_COPY =
  "Your changes weren't saved. Try again; if it keeps failing, copy your text somewhere safe first.";

const FormOptionsContext = createContext<FormOptionsContextValue | null>(null);

export function FormOptionsProvider({
  forms,
  createForm,
  children,
}: FormOptionsProviderProps) {
  const [added, setAdded] = useState<FormOption[]>([]);
  const list = useMemo(() => {
    const seen = new Set(forms.map((f) => f.id));
    return [...forms, ...added.filter((f) => !seen.has(f.id))];
  }, [forms, added]);

  const create = useCallback(
    async (template: string): Promise<CreateFormOutcome> => {
      try {
        const res = await createForm({ template });
        if (!res.ok)
          return { ok: false, message: res.message || FALLBACK_COPY };
        const option: FormOption = { id: res.data.id, name: res.data.name };
        setAdded((a) => [...a, option]);
        return { ok: true, option };
      } catch {
        return { ok: false, message: FALLBACK_COPY };
      }
    },
    [createForm],
  );

  const value = useMemo(
    () => ({ forms: list, createForm: create }),
    [list, create],
  );
  return (
    <FormOptionsContext.Provider value={value}>
      {children}
    </FormOptionsContext.Provider>
  );
}

/** The site's forms and create-from-template, or null outside a provider (old callers). */
export function useFormOptions(): FormOptionsContextValue | null {
  return useContext(FormOptionsContext);
}
