export type UploadResult = {
  total: number;
  inserted: number;
  duplicates: number;
  unclassified: number;
};

export type UploadErrorBody = { error: string };
