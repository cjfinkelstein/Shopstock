import { useEffect, useState } from "react";
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

  useEffect(() => {
    api<ClockOutPhotoFeedItem[]>("/time/photos")
      .then(setPhotos)
      .catch(() => setPhotos([]));
  }, []);

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
              <AuthedImage
                src={p.url}
                alt={p.caption ?? "Clock-out photo"}
                className="h-24 w-24 shrink-0 rounded-xl object-cover"
              />
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
    </div>
  );
}
