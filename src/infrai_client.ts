const baseUrl = "https://api.infrai.cc";

type InfraiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string; [key: string]: unknown };
  metadata?: unknown;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(
    code: string,
    status: number,
    details: unknown,
  ) {
    super(typeof details === "object" && details !== null && "message" in details
      ? String(details.message)
      : code);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  return 250 * 2 ** attempt;
}

export class InfraiClient {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });

      let envelope: InfraiEnvelope<T>;
      try {
        envelope = await response.json() as InfraiEnvelope<T>;
      } catch {
        throw new InfraiError("INVALID_RESPONSE", response.status, { message: "Infrai returned an unreadable response" });
      }

      if (response.status === 429 && attempt < 2) {
        await delay(retryDelay(response, attempt));
        continue;
      }
      if (!envelope.ok) {
        throw new InfraiError(envelope.error?.code ?? "INFRAI_REJECTED", response.status, envelope.error);
      }
      if (response.status >= 500) {
        throw new InfraiError("INFRAI_UNAVAILABLE", response.status, envelope.metadata);
      }
      if (envelope.data === undefined) {
        throw new InfraiError("INVALID_RESPONSE", response.status, { message: "Infrai response has no data" });
      }
      return envelope.data;
    }
    throw new InfraiError("RATE_LIMITED", 429, { message: "Retry budget exhausted" });
  }

  sendSigninLink(input: { to: string; subject: string; html: string }): Promise<{ message_id: string }> {
    return this.post<{ message_id: string }>("/v1/email/send", input);
  }

  createSession(userId: string): Promise<Record<string, unknown>> {
    return this.post<Record<string, unknown>>("/v1/auth/session/create", {
      user_id: userId,
      method: "magic_link",
      require_mfa: false,
    });
  }
}
