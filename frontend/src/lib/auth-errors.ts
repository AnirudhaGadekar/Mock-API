const PUBLIC_EMAIL_DELIVERY_ERROR =
  "Email verification is temporarily unavailable. Please use Google or GitHub sign-in, or try again later.";

type ApiErrorPayload = {
  code?: string;
  error?: string;
};

type ErrorLike = {
  response?: {
    data?: ApiErrorPayload;
  };
};

function isEmailDeliveryError(payload: ApiErrorPayload | undefined): boolean {
  const code = payload?.code;
  const message = payload?.error ?? "";

  return (
    code === "EMAIL_PROVIDER_SANDBOX" ||
    code === "EMAIL_PROVIDER_ERROR" ||
    message.includes("Email sending is disabled in this environment") ||
    message.startsWith("Email delivery failed:")
  );
}

export function getAuthErrorMessage(error: ErrorLike | undefined, fallback: string): string {
  const payload = error?.response?.data;

  if (isEmailDeliveryError(payload)) {
    return PUBLIC_EMAIL_DELIVERY_ERROR;
  }

  return payload?.error || fallback;
}

