"use client";
// Save / Remove for one Gallery photo, side by side in the same form. Remove asks first.
import { Button } from "@cds/ui/hub";
import { useFormStatus } from "react-dom";

export function GalleryButtons({
  remove,
}: {
  remove: (form: FormData) => Promise<void>;
}) {
  const { pending } = useFormStatus();
  return (
    <div className="flex gap-2">
      <Button type="submit" size="sm" disabled={pending}>
        Save
      </Button>
      <Button
        type="submit"
        size="sm"
        variant="secondary"
        disabled={pending}
        formAction={remove}
        formNoValidate
        onClick={(e) => {
          if (!window.confirm("Remove this photo from the Gallery?"))
            e.preventDefault();
        }}
      >
        Remove
      </Button>
    </div>
  );
}
