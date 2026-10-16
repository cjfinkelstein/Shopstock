import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api } from "../../api";
import Icon from "../../components/Icon";
import JobPicker from "../../components/JobPicker";
import Sheet from "../../components/Sheet";
import { Spinner } from "../../components/ui";
import { useToast } from "../../toast";
import type { Job } from "../../types";

const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15MB, same guard as the admin job-files uploader

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function Receipts() {
  const navigate = useNavigate();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<{ file: File; previewUrl: string } | null>(null);
  const [uploading, setUploading] = useState(false);

  const choosePhoto = (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      toast("error", "That photo is too large (max 15MB)");
      return;
    }
    if (pendingFile) URL.revokeObjectURL(pendingFile.previewUrl);
    setPendingFile({ file, previewUrl: URL.createObjectURL(file) });
  };

  const discard = () => {
    if (uploading) return;
    if (pendingFile) URL.revokeObjectURL(pendingFile.previewUrl);
    setPendingFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const uploadToJob = async (job: Job) => {
    if (!pendingFile) return;
    setUploading(true);
    try {
      const dataUrl = await readAsDataUrl(pendingFile.file);
      await api(`/jobs/${job.id}/files`, {
        method: "POST",
        body: {
          kind: "photo",
          filename: pendingFile.file.name,
          mime_type: pendingFile.file.type || "image/jpeg",
          data: dataUrl,
        },
      });
      toast("success", `Receipt added to ${job.job_number}`);
      discard();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Couldn't upload receipt");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-5 animate-fade-up">
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
          <p className="page-eyebrow">Attach to a job</p>
          <h1 className="page-title mt-1">Receipts</h1>
        </div>
      </header>

      <button type="button" onClick={() => fileInputRef.current?.click()} className="btn-primary w-full">
        <Icon name="file-text" size={18} />
        Add receipt
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => choosePhoto(e.target.files?.[0])}
      />

      <p className="text-center text-[13px] text-slate-400 dark:text-slate-500">
        Take a photo or pick one from your gallery, then choose which job it's for.
      </p>

      {pendingFile && (
        <Sheet title="What job is this for?" onClose={discard}>
          <div className="space-y-4">
            <img
              src={pendingFile.previewUrl}
              alt="Receipt"
              className="mx-auto max-h-[30vh] rounded-xl object-contain"
            />
            {uploading ? (
              <div className="flex items-center justify-center py-8">
                <Spinner />
              </div>
            ) : (
              <JobPicker onPick={uploadToJob} allowCreate />
            )}
          </div>
        </Sheet>
      )}
    </div>
  );
}
