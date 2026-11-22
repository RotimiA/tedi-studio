import {createHmac, timingSafeEqual} from "node:crypto";
import {writeFile} from "node:fs/promises";
import path from "node:path";
import {revalidatePath} from "next/cache";
import {SyncError} from "@/lib/portfolio-sync/errors";
import {isNotionPageId} from "@/lib/portfolio-sync/map-project";
import {syncProjects, type SyncResult} from "@/lib/portfolio-sync/sync";

const recentRequests = new Map<string, number[]>();

type Payload = {
  pageId?: unknown;
  verification_token?: unknown;
  entity?: {id?: unknown; type?: unknown};
};

export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > 1_000_000) {
    return Response.json({error: "Payload is too large."}, {status: 413});
  }

  let payload: Payload | null = null;
  if (raw) {
    try {
      payload = JSON.parse(raw) as Payload;
    } catch {
      return Response.json({error: "Expected JSON."}, {status: 400});
    }
  }

  if (typeof payload?.verification_token === "string" && payload.verification_token) {
    await storeVerificationToken(payload.verification_token);
    return Response.json({ok: true});
  }

  const manual = bearerMatches(
    request.headers.get("authorization"),
    process.env.SYNC_SECRET ?? "",
  );
  const webhook = signed(
    raw,
    request.headers.get("x-notion-signature"),
    process.env.NOTION_WEBHOOK_SECRET ?? "",
  );

  if (!manual && !webhook) {
    return Response.json({error: "Unauthorized."}, {status: 401});
  }
  if (limited(manual ? "manual" : "webhook")) {
    return Response.json({error: "Too many sync requests."}, {status: 429});
  }

  if (webhook && payload?.entity?.type && payload.entity.type !== "page") {
    return Response.json({results: []});
  }

  const pageId = manual ? payload?.pageId : payload?.entity?.id;
  if (pageId !== undefined && typeof pageId !== "string") {
    return Response.json({error: "pageId must be a Notion page ID."}, {status: 400});
  }
  if (typeof pageId === "string" && !isNotionPageId(pageId)) {
    return Response.json({error: "pageId must be a Notion page ID."}, {status: 400});
  }

  try {
    const results = await syncProjects(typeof pageId === "string" ? {pageId} : {});
    revalidateChanged(results);
    return Response.json({results});
  } catch (error) {
    const message = error instanceof SyncError ? error.message : "Sync failed.";
    return Response.json({error: message}, {status: 500});
  }
}

function revalidateChanged(results: SyncResult[]) {
  const changed = results.some(
    (result) => result.outcome === "ok" && result.operation !== "skip" && result.operation !== "review",
  );
  if (!changed) return;

  const paths = new Set(["/", "/projects"]);
  for (const result of results) {
    if (result.slug) paths.add(`/projects/${result.slug}`);
    if (result.previousSlug) paths.add(`/projects/${result.previousSlug}`);
  }
  for (const path of paths) revalidatePath(path);
}

function bearerMatches(header: string | null, secret: string) {
  if (!secret || !header?.startsWith("Bearer ")) return false;
  return safeEqual(header.slice("Bearer ".length).trim(), secret);
}

function signed(body: string, signature: string | null, secret: string) {
  if (!secret || !signature) return false;
  const digest = createHmac("sha256", secret).update(body).digest("hex");
  return safeEqual(signature.trim(), digest) || safeEqual(signature.trim(), `sha256=${digest}`);
}

function safeEqual(leftValue: string, rightValue: string) {
  const left = Buffer.from(leftValue);
  const right = Buffer.from(rightValue);
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

function limited(key: string) {
  const now = Date.now();
  const hits = (recentRequests.get(key) ?? []).filter((time) => now - time < 60_000);
  if (hits.length >= 30) return true;
  hits.push(now);
  recentRequests.set(key, hits);
  return false;
}

async function storeVerificationToken(token: string) {
  const destination = path.join(process.cwd(), ".notion-webhook-token");
  await writeFile(destination, `${token}\n`, {encoding: "utf8", mode: 0o600, flag: "wx"}).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    },
  );
}
