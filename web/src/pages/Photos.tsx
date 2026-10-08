import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";

import { api, apiUpload, fmtWhen } from "../api";
import AuthedImage from "../components/AuthedImage";
import Icon from "../components/Icon";
import Sheet from "../components/Sheet";
import { Empty, ListSkeleton, Spinner } from "../components/ui";
import { useToast } from "../toast";
import type { ClockOutPhotoFeedItem } from "../types";

function fmtShiftDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export default function Photos() {
  const navigate = useNavigate();
  const toast = useToast();
  const [photos, setPhotos] = useState<ClockOutPhotoFeedItem[] | null>(null);
  const [zoomed, setZoomed] = useState<ClockOutPhotoFeedItem | null>(null);
  const [pendingPhoto, setPendingPhoto] = useState<{ file: File; previewUrl: string } | null>(null);
  const [pendingCaption, setPendingCaption] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadPhotos = () =>
    api<ClockOutPhotoFeedItem[]>("/time/photos")
      .then(setPhotos)
      .catch(() => setPhotos([]));

  useEffect(() => {
    loadPhotos();
  }, []);

  const discardPendingPhoto = () => {
    if (pendingPhoto) URL.revokeObjectURL(pendingPhoto.previewUrl);
    setPendingPhoto(null);
    setPendingCaption("");
  };

  const choosePhoto = (file: File | undefined) => {
    if (!file) return;
    discardPendingPhoto();
    setPendingPhoto({ file, previewUrl: URL.createObjectURL(file) });
  };

  const uploadPendingPhoto = async () => {
    if (!pendingPhoto) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", pendingPhoto.file);
      if (pendingCaption.trim()) form.append("caption", pendingCaption.trim());
      await apiUpload("/time/clock-out/photos", form);
      discardPendingPhoto();
      if (fileInputRef.current) fileInputRef.current.value = "";
      await loadPhotos();
      toast("success", "Photo added");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Couldn't upload photo");
    } finally {
      setUploading(false);
    }
  };

  useEffect(() => {
    if (!zoomed) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setZoomed(null);
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [zoomed]);

  return (
    <div className="mx-auto max-w-3xl space-y-6 animate-fade-up">
      <header className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Back"
          className="-ml-1.5 rounded-full p-1.5 text-slate-400 transition-colors hover:text-slate-600 dark:hover:text-slate-200"
        >
          <Icon name="arrow-left" size={20} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="page-eyebrow">Everyone can see</p>
          <h1 className="page-title mt-1">Photos</h1>
        </div>
        <button className="btn-primary !min-h-[40px] px-3.5 text-[13px]" onClick={() => fileInputRef.current?.click()}>
          <Icon name="camera" size={16} />
          Add photo
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => choosePhoto(e.target.files?.[0])}
        />
      </header>

      {!photos ? (
        <ListSkeleton rows={4} height={120} />
      ) : photos.length === 0 ? (
        <Empty icon="camera" title="No photos yet" hint="Tap Add photo to post the first one." />
      ) : (
        <div className="space-y-3">
          {photos.map((p) => (
            <div key={p.id} className="card flex gap-3 p-3">
              <button
                type="button"
                onClick={() => setZoomed(p)}
                aria-label="View full size"
                className="shrink-0"
              >
                <AuthedImage
                  src={p.url}
                  alt={p.caption ?? "Clock-out photo"}
                  className="h-24 w-24 rounded-xl object-cover"
                />
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-bold">{p.uploaded_by_name}</p>
                <p className="text-[12px] text-slate-400 dark:text-slate-500">
                  {fmtShiftDate(p.shift_date)} · uploaded {fmtWhen(p.created_at)}
                </p>
                {p.caption && (
                  <p className="mt-1.5 text-[13.5px] text-slate-600 dark:text-slate-300">{p.caption}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {zoomed &&
        createPortal(
          <div
            className="fixed inset-0 z-[1100] flex flex-col items-center justify-center bg-slate-950/90 p-4 animate-fade-in"
            onClick={() => setZoomed(null)}
          >
            <button
              type="button"
              onClick={() => setZoomed(null)}
              aria-label="Close"
              className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white"
            >
              <Icon name="x" size={20} />
            </button>
            <AuthedImage
              src={zoomed.url}
              alt={zoomed.caption ?? "Clock-out photo"}
              className="max-h-[75vh] max-w-full rounded-lg object-contain"
            />
            <div className="mt-4 max-w-md text-center text-white" onClick={(e) => e.stopPropagation()}>
              <p className="text-[14px] font-bold">{zoomed.uploaded_by_name}</p>
              <p className="text-[12px] text-white/60">{fmtShiftDate(zoomed.shift_date)}</p>
              {zoomed.caption && <p className="mt-1.5 text-[13.5px] text-white/85">{zoomed.caption}</p>}
            </div>
          </div>,
          document.body,
        )}

      {pendingPhoto && (
        <Sheet title="Add photo" subtitle="Visible to everyone" onClose={discardPendingPhoto}>
          <div className="space-y-4">
            <img
              src={pendingPhoto.previewUrl}
              alt="Selected"
              className="mx-auto max-h-[45vh] w-full rounded-xl object-contain"
            />
            <label className="block">
              <span className="label">Caption (optional)</span>
              <input
                className="input"
                placeholder="What's this a photo of?"
                value={pendingCaption}
                onChange={(e) => setPendingCaption(e.target.value)}
              />
            </label>
            <button className="btn-primary w-full" disabled={uploading} onClick={uploadPendingPhoto}>
              {uploading ? <Spinner /> : <Icon name="camera" size={18} />}
              Post photo
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
