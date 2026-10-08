import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";

import { api, fmtWhen } from "../api";
import AuthedImage from "../components/AuthedImage";
import Icon from "../components/Icon";
import { Empty, ListSkeleton } from "../components/ui";
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
  const [photos, setPhotos] = useState<ClockOutPhotoFeedItem[] | null>(null);
  const [zoomed, setZoomed] = useState<ClockOutPhotoFeedItem | null>(null);

  useEffect(() => {
    api<ClockOutPhotoFeedItem[]>("/time/photos")
      .then(setPhotos)
      .catch(() => setPhotos([]));
  }, []);

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
        <div>
          <p className="page-eyebrow">Everyone can see</p>
          <h1 className="page-title mt-1">Photos</h1>
        </div>
      </header>

      {!photos ? (
        <ListSkeleton rows={4} height={120} />
      ) : photos.length === 0 ? (
        <Empty icon="camera" title="No photos yet" hint="Photos added at clock-out show up here." />
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
    </div>
  );
}
