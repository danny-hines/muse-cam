"use client";

import { useFormStatus } from "react-dom";

import { captionPhoto } from "@/app/admin/actions";

function CaptionButton({ hasCaption }: { hasCaption: boolean }) {
  const { pending } = useFormStatus();
  // Muse Spark takes several seconds, so show that the request is still running.
  return (
    <button type="submit" disabled={pending}>
      {pending ? "Writing…" : hasCaption ? "New caption" : "Write caption"}
    </button>
  );
}

export function CaptionPhotoForm({ id, hasCaption }: { id: string; hasCaption: boolean }) {
  return (
    <form action={captionPhoto}>
      <input type="hidden" name="id" value={id} />
      <CaptionButton hasCaption={hasCaption} />
    </form>
  );
}
