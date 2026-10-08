export const SUPPORTED_EXTENSIONS = [".csv", ".xlsx", ".xls"] as const;
export const UNSUPPORTED_FORMAT_MESSAGE =
  "지원하지 않는 파일 형식이에요. CSV 또는 Excel(.xlsx, .xls) 파일을 올려 주세요.";
export const EMPTY_FILE_MESSAGE = "파일에 내용이 없어요.";

export function hasSupportedExtension(fileName: string): boolean {
  const lowerName = fileName.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
}
