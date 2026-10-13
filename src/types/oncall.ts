export type OncallAlertKind = "created" | "reopened" | "spiking";

export type OncallAlert = {
  eventId: string;
  kind: OncallAlertKind;
  issueId: string;
};

export type OncallWebhookResult = { status: "dispatched" | "duplicate" };

export type OncallWebhookErrorBody = { error: string };
