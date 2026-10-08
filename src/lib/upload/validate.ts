import {
  EMPTY_FILE_MESSAGE,
  UNSUPPORTED_FORMAT_MESSAGE,
  hasSupportedExtension,
} from "@/lib/parser/file-rules";

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_TRANSACTIONS_PER_UPLOAD = 5000;
export const MAX_UPLOADS_PER_DAY = 20;

export function validateUploadFile(file: { name: string; size: number }): string | null {
  if (!hasSupportedExtension(file.name)) return UNSUPPORTED_FORMAT_MESSAGE;
  if (file.size === 0) return EMPTY_FILE_MESSAGE;
  if (file.size > MAX_UPLOAD_BYTES) return "파일이 너무 커요. 4MB 이하 파일을 올려 주세요.";
  return null;
}

export function maxAllowedDate(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
    .toISOString().slice(0, 10);
}
