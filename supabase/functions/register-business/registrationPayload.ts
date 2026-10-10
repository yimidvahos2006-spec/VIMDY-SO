export interface RegistrationPayload {
  businessName?: string;
  ownerName?: string;
  country?: string;
  businessType?: string;
  registrationMode?: "initial" | "additional";
}

export type RegistrationPayloadParseResult =
  | { ok: true; payload: RegistrationPayload }
  | { ok: false; error: "INVALID_BODY" | "INVALID_FIELD_TYPE" | "REGISTRATION_MODE_INVALID" };

const STRING_FIELDS = ["businessName", "ownerName", "country", "businessType"] as const;

export function parseRegistrationPayload(value: unknown): RegistrationPayloadParseResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: "INVALID_BODY" };
  }

  const body = value as Record<string, unknown>;
  for (const field of STRING_FIELDS) {
    if (body[field] !== undefined && typeof body[field] !== "string") {
      return { ok: false, error: "INVALID_FIELD_TYPE" };
    }
  }

  const registrationMode = body.registrationMode;
  if (
    registrationMode !== undefined &&
    registrationMode !== "initial" &&
    registrationMode !== "additional"
  ) {
    return { ok: false, error: "REGISTRATION_MODE_INVALID" };
  }

  return {
    ok: true,
    payload: {
      businessName: typeof body.businessName === "string" ? body.businessName.trim() : undefined,
      ownerName: typeof body.ownerName === "string" ? body.ownerName.trim() : undefined,
      country: typeof body.country === "string" ? body.country.trim() : undefined,
      businessType: typeof body.businessType === "string" ? body.businessType.trim() : undefined,
      registrationMode: registrationMode as RegistrationPayload["registrationMode"]
    }
  };
}