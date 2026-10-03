import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { z } from "zod";
import { InfraiClient, InfraiError } from "./infrai_client.js";
import { MagicLinkService, SigninRejected, type LinkRequest } from "./magic_link_service.js";

const linkRequestSchema = z.object({
  requestId: z.string().min(1),
  userId: z.string().min(1),
  email: z.string().email(),
  paymentEvent: z.object({
    eventId: z.string().min(1),
    type: z.enum(["checkout_payment_authorized", "refund_requested", "payout_destination_changed"]),
    amountMinor: z.number().int().nonnegative(),
    currency: z.string().regex(/^[A-Z]{3}$/),
  }),
  risk: z.object({
    score: z.number().min(0).max(100),
    newDevice: z.boolean(),
  }),
});

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 32_768) throw new Error("Request body is too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function reply(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function clientStatus(error: InfraiError): number {
  if (error.status >= 400 && error.status < 500) return error.status;
  return 502;
}

const apiKey = requiredEnv("INFRAI_API_KEY");
const service = new MagicLinkService(
  new InfraiClient(apiKey),
  requiredEnv("MAGIC_LINK_SECRET"),
  process.env.PUBLIC_BASE_URL ?? "http://localhost:3000",
);

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (request.method === "POST" && url.pathname === "/signin/request") {
      const parsed = linkRequestSchema.safeParse(await readJson(request));
      if (!parsed.success) {
        reply(response, 400, { ok: false, error: "invalid_request", issues: parsed.error.issues });
        return;
      }
      const receipt = await service.requestLink(parsed.data as LinkRequest);
      reply(response, 202, { ok: true, receipt });
      return;
    }
    if (request.method === "GET" && url.pathname === "/signin/redeem") {
      const token = url.searchParams.get("token");
      if (!token) {
        reply(response, 400, { ok: false, error: "token_required" });
        return;
      }
      const result = await service.redeem(token);
      reply(response, 200, { ok: true, ...result });
      return;
    }
    reply(response, 404, { ok: false, error: "route_not_found" });
  } catch (error) {
    if (error instanceof SigninRejected) {
      reply(response, error.outcome === "review" ? 403 : 401, { ok: false, decision: error.outcome, reason: error.reason });
      return;
    }
    if (error instanceof InfraiError) {
      reply(response, clientStatus(error), { ok: false, error: error.code });
      return;
    }
    reply(response, 400, { ok: false, error: error instanceof Error ? error.message : "bad_request" });
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`Checkout sign-in service listening on http://localhost:${port}`));
