"use client";

import { useState } from "react";
import type { FormEvent, JSX } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { validateUploadFile } from "@/lib/upload/validate";
import type { UploadResult } from "@/types/upload";

const PROCESSING_ERROR = "업로드를 처리하지 못했어요. 잠시 후 다시 시도해 주세요.";

function isUploadResult(data: unknown): data is UploadResult {
  if (typeof data !== "object" || data === null) return false;
  const record = data as Record<string, unknown>;
  return ["total", "inserted", "duplicates", "unclassified"].every((key) => {
    const value = record[key];
    return typeof value === "number" && Number.isInteger(value) && value >= 0;
  });
}

function errorMessage(data: unknown): string {
  if (typeof data === "object" && data !== null && "error" in data && typeof data.error === "string" && data.error) return data.error;
  return PROCESSING_ERROR;
}

export function UploadForm(): JSX.Element {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;
    setError(null);
    setSuccess(null);
    const input = event.currentTarget.elements.namedItem("file");
    const file = input instanceof HTMLInputElement ? input.files?.[0] : undefined;
    if (!file) {
      setError("파일을 선택해 주세요.");
      return;
    }
    const validationError = validateUploadFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }
    const body = new FormData();
    body.set("file", file);
    setIsPending(true);
    try {
      let response: Response;
      try {
        response = await fetch("/api/upload", { method: "POST", body });
      } catch {
        setError("업로드에 실패했어요. 네트워크 연결을 확인해 주세요.");
        return;
      }
      let data: unknown;
      try {
        data = await response.json();
      } catch {
        setError(PROCESSING_ERROR);
        return;
      }
      if (response.status !== 200) {
        setError(errorMessage(data));
        return;
      }
      if (!isUploadResult(data)) {
        setError(PROCESSING_ERROR);
        return;
      }
      const { inserted, duplicates, unclassified } = data;
      let message = `${inserted}건을 저장했어요.`;
      if (duplicates > 0) message += ` 이미 있는 ${duplicates}건은 건너뛰었어요.`;
      if (unclassified > 0) message += ` 분류하지 못한 ${unclassified}건은 기타로 저장했어요. 같은 파일을 다시 올리면 다시 분류해요.`;
      setSuccess(message);
      router.refresh();
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} noValidate className="flex flex-col items-start gap-4">
        <div className="flex w-full min-w-0 flex-col gap-1.5">
          <Input label="거래 내역 파일" name="file" type="file" accept=".csv,.xlsx,.xls" disabled={isPending} aria-invalid={!!error} aria-describedby={error ? "upload-period upload-error" : "upload-period"} />
          <p id="upload-period" className="break-keep text-sm text-muted">화면에는 가장 최근 거래일까지의 1개월만 나와요. 더 오래된 내역은 저장만 돼요.</p>
          {error && <p id="upload-error" role="alert" className="break-keep text-sm text-danger">{error}</p>}
        </div>
        <Button type="submit" disabled={isPending}>{isPending ? "올리는 중…" : "올리기"}</Button>
        {success && <p role="status" className="break-keep text-sm text-foreground">{success}</p>}
      </form>
    </Card>
  );
}
