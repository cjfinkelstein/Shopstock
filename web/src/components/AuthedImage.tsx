import { useEffect, useState } from "react";

import { apiBlob } from "../api";

/** <img src> can't carry the Authorization header our API requires (e.g.
 * clock-out photos, admin-only), so this fetches the bytes with auth and
 * renders them as an object URL instead -- for anything already public
 * (item images, etc.) a plain <img> is simpler and fine. */
export default function AuthedImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    apiBlob(src)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  if (!url) {
    return <div className={`animate-pulse bg-slate-200 dark:bg-slate-700 ${className ?? ""}`} />;
  }
  return <img src={url} alt={alt} className={className} />;
}
