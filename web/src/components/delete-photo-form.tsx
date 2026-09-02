"use client";

import type { FormEvent } from "react";

import { deletePhoto } from "@/app/admin/actions";

export function DeletePhotoForm({ id }: { id: string }) {
  function confirmDelete(event: FormEvent<HTMLFormElement>) {
    if (!window.confirm("Permanently delete this photo and both stored images?")) {
      event.preventDefault();
    }
  }

  return (
    <form action={deletePhoto} onSubmit={confirmDelete}>
      <input type="hidden" name="id" value={id} />
      <button className="danger-button" type="submit">
        Delete permanently
      </button>
    </form>
  );
}
