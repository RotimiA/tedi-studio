import {randomUUID} from "node:crypto";
import {writeClient} from "../../sanity/write-client.ts";
import {SyncError} from "./errors.ts";
import {
  isCurrentOrNewer,
  pageInSource,
  planProject,
  type NotionPage,
  type PendingImage,
  type PlannedDocument,
  type SyncPlan,
} from "./map-project.ts";
import {getProjectPage, listPageBlocks, listProjectPages} from "./notion.ts";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
]);

export type SyncResult = {
  notionPageId: string;
  operation: "publish" | "draft" | "unpublish" | "skip" | "reject" | "review";
  outcome: "ok" | "error" | "skipped";
  slug?: string;
  previousSlug?: string;
  warnings?: string[];
  errors?: string[];
  errorCategory?: string;
};

type StoredProject = {
  _id: string;
  sourceUpdatedAt?: string;
  slug?: {current?: string};
};

export async function syncProjects(options: {pageId?: string} = {}) {
  if (options.pageId) {
    const page = await getProjectPage(options.pageId);
    if (!page) {
      return [
        reviewResult(
          options.pageId,
          "Notion page was not found. The published project was left unchanged.",
        ),
      ];
    }
    if (page.archived || page.in_trash) {
      return [
        reviewResult(
          page.id,
          "The Notion page is archived. The published project was left unchanged.",
        ),
      ];
    }
    if (!pageInSource(page, sourceIds())) {
      return [
        {
          notionPageId: page.id,
          operation: "skip" as const,
          outcome: "skipped" as const,
          warnings: ["Page is outside the selected Projects database."],
        },
      ];
    }
    return [await syncPage(page)];
  }

  const pages = await listProjectPages();
  const results: SyncResult[] = [];
  for (const page of pages) {
    if (page.archived || page.in_trash) {
      results.push(
        reviewResult(
          page.id,
          "The Notion page is archived. The published project was left unchanged.",
        ),
      );
      continue;
    }
    results.push(await syncPage(page));
  }
  return results;
}

async function syncPage(page: NotionPage): Promise<SyncResult> {
  try {
    const {blocks, truncated} = await listPageBlocks(page.id);
    if (truncated) {
      const result: SyncResult = {
        notionPageId: page.id,
        operation: "reject",
        outcome: "error",
        errorCategory: "validation",
        errors: ["The Notion page is too large to sync safely."],
      };
      logResult(result);
      return result;
    }

    const plan = planProject(page, blocks);
    const result = await applyPlan(plan);
    logResult(result);
    return result;
  } catch (error) {
    const result: SyncResult = {
      notionPageId: page.id,
      operation: "reject",
      outcome: "error",
      errorCategory: error instanceof SyncError ? error.category : "unexpected",
      errors: [error instanceof SyncError ? error.message : "Sync failed."],
    };
    logResult(result);
    return result;
  }
}

async function applyPlan(plan: SyncPlan): Promise<SyncResult> {
  const client = writeClient();
  let existing = await findExisting(client, plan.notionPageId);
  const current = existing.published ?? existing.draft;
  const incoming = plan.sourceUpdatedAt || plan.document?.sourceUpdatedAt;

  if (
    current?.sourceUpdatedAt &&
    incoming &&
    !isCurrentOrNewer(current.sourceUpdatedAt, incoming)
  ) {
    return {
      notionPageId: plan.notionPageId,
      operation: "skip",
      outcome: "skipped",
      warnings: ["A newer copy is already stored."],
    };
  }

  if (plan.action === "reject") {
    return {
      notionPageId: plan.notionPageId,
      operation: "reject",
      outcome: "error",
      errorCategory: "validation",
      errors: plan.errors,
      warnings: plan.warnings,
    };
  }

  if (plan.action === "withhold") {
    const latest = await confirmCurrent(client, plan.notionPageId, incoming);
    if (!latest) return staleResult(plan.notionPageId);
    if (!latest.published) {
      return {
        notionPageId: plan.notionPageId,
        operation: "skip",
        outcome: "skipped",
        warnings: plan.warnings,
      };
    }
    await client.delete(latest.published._id);
    if (latest.draft) await client.delete(latest.draft._id);
    return {
      notionPageId: plan.notionPageId,
      operation: "unpublish",
      outcome: "ok",
      previousSlug: latest.published.slug?.current,
      warnings: plan.warnings,
    };
  }

  if (!plan.document) {
    throw new SyncError("Sync plan was missing a document.", "unexpected");
  }

  if (plan.action === "publish" && plan.document.slug) {
    const conflict = await countSlugConflicts(
      client,
      plan.document.slug.current,
      plan.notionPageId,
    );
    if (conflict > 0) {
      return {
        notionPageId: plan.notionPageId,
        operation: "reject",
        outcome: "error",
        errorCategory: "validation",
        errors: ["This slug is already used by another project."],
        warnings: plan.warnings,
      };
    }
  }

  const latest = await confirmCurrent(client, plan.notionPageId, incoming);
  if (!latest) return staleResult(plan.notionPageId);
  existing = latest;

  const payload = await materialize(client, plan.document);
  const previousSlug = existing.published?.slug?.current;

  if (plan.action === "publish") {
    if (existing.published) {
      await patchDocument(client, existing.published._id, payload);
    } else if (existing.draft) {
      const id = existing.draft._id.replace(/^drafts\./, "");
      await client.createOrReplace({_id: id, _type: "project", ...payload.set});
    } else {
      await client.create({_type: "project", ...payload.set});
    }
    if (existing.draft) await client.delete(existing.draft._id).catch(() => undefined);
    return {
      notionPageId: plan.notionPageId,
      operation: "publish",
      outcome: "ok",
      slug: plan.document.slug?.current,
      previousSlug:
        previousSlug && previousSlug !== plan.document.slug?.current
          ? previousSlug
          : undefined,
      warnings: plan.warnings,
    };
  }

  const publishedId = existing.published?._id ?? existing.draft?._id.replace(/^drafts\./, "");
  const draftId = publishedId ? `drafts.${publishedId}` : `drafts.${randomUUID()}`;
  await client.createOrReplace({_id: draftId, _type: "project", ...payload.set});
  if (existing.published) await client.delete(existing.published._id);

  return {
    notionPageId: plan.notionPageId,
    operation: plan.action === "unpublish" ? "unpublish" : "draft",
    outcome: "ok",
    previousSlug: existing.published ? previousSlug : undefined,
    warnings: plan.warnings,
  };
}

async function materialize(
  client: ReturnType<typeof writeClient>,
  document: PlannedDocument,
) {
  let heroAssetId: string | undefined;
  if (document.hero) {
    heroAssetId = await uploadImage(client, document.hero, "hero");
  }

  const body = [];
  for (const block of document.body) {
    if (block._type === "image") {
      const assetId = await uploadImage(client, block._pending, "body");
      body.push({
        _type: "image" as const,
        _key: block._key,
        alt: block.alt || document.title,
        asset: {_type: "reference" as const, _ref: assetId},
      });
      continue;
    }
    body.push(block);
  }

  const set: Record<string, unknown> = {
    title: document.title,
    notionPageId: document.notionPageId,
    sourceUpdatedAt: document.sourceUpdatedAt,
    lastSyncedAt: new Date().toISOString(),
    portfolioStatus: document.portfolioStatus,
    disciplines: document.disciplines,
    tools: document.tools,
    body,
  };
  const optional: Record<string, unknown> = {
    slug: document.slug,
    summary: document.summary,
    description: document.description,
    objective: document.objective,
    role: document.role,
    deliverablesText: document.deliverablesText,
    outcomesText: document.outcomesText,
    projectStatus: document.projectStatus,
    startDate: document.startDate,
    endDate: document.endDate,
    projectUrl: document.projectUrl,
    mainImage: heroAssetId
      ? {
          _type: "image",
          alt: document.hero?.alt || document.title,
          asset: {_type: "reference", _ref: heroAssetId},
        }
      : undefined,
  };
  const unset: string[] = [];
  for (const [key, value] of Object.entries(optional)) {
    if (value === undefined || value === "") unset.push(key);
    else set[key] = value;
  }

  return {set, unset};
}

async function patchDocument(
  client: ReturnType<typeof writeClient>,
  id: string,
  payload: {set: Record<string, unknown>; unset: string[]},
) {
  const patch = client.patch(id).set(payload.set);
  if (payload.unset.length > 0) patch.unset(payload.unset);
  await patch.commit();
}

async function uploadImage(
  client: ReturnType<typeof writeClient>,
  image: PendingImage,
  kind: "hero" | "body",
) {
  let url: URL;
  try {
    url = new URL(image.url);
  } catch {
    throw new SyncError(`The ${kind} image URL is invalid.`, "asset");
  }
  if (url.protocol !== "https:") {
    throw new SyncError(`The ${kind} image must use https.`, "asset");
  }

  const response = await fetch(url, {signal: AbortSignal.timeout(20_000)});
  if (!response.ok) {
    throw new SyncError(`The ${kind} image could not be downloaded.`, "asset");
  }
  if (response.url && !response.url.startsWith("https:")) {
    throw new SyncError(`The ${kind} image must use https.`, "asset");
  }

  const contentType = (response.headers.get("content-type") ?? "").split(";")[0]?.trim();
  if (!contentType || !IMAGE_TYPES.has(contentType)) {
    throw new SyncError(`The ${kind} image type is not supported.`, "asset");
  }

  const length = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > MAX_IMAGE_BYTES) {
    throw new SyncError(`The ${kind} image is too large.`, "asset");
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new SyncError(`The ${kind} image is too large.`, "asset");
  }

  const asset = await client.assets.upload("image", bytes, {
    filename: image.filename,
    contentType,
  });
  return asset._id;
}

async function findExisting(client: ReturnType<typeof writeClient>, notionPageId: string) {
  const docs = await read<StoredProject[]>(
    client,
    `*[_type == "project" && notionPageId == $notionPageId]{ _id, sourceUpdatedAt, slug }`,
    {notionPageId},
  );
  return {
    published: docs.find((doc) => !doc._id.startsWith("drafts.")),
    draft: docs.find((doc) => doc._id.startsWith("drafts.")),
  };
}

async function countSlugConflicts(
  client: ReturnType<typeof writeClient>,
  slug: string,
  notionPageId: string,
) {
  return read<number>(
    client,
    `count(*[_type == "project" && slug.current == $slug && notionPageId != $notionPageId])`,
    {slug, notionPageId},
  );
}

async function read<T>(
  client: ReturnType<typeof writeClient>,
  query: string,
  params: Record<string, unknown>,
) {
  const fetchRaw = client.fetch as unknown as (
    query: string,
    params: Record<string, unknown>,
    options: {perspective: "raw"},
  ) => Promise<T>;
  return fetchRaw(query, params, {perspective: "raw"});
}

async function confirmCurrent(
  client: ReturnType<typeof writeClient>,
  notionPageId: string,
  incoming: string | undefined,
) {
  const latest = await findExisting(client, notionPageId);
  const current = latest.published ?? latest.draft;
  if (
    current?.sourceUpdatedAt &&
    incoming &&
    !isCurrentOrNewer(current.sourceUpdatedAt, incoming)
  ) {
    return null;
  }
  return latest;
}

function staleResult(notionPageId: string): SyncResult {
  return {
    notionPageId,
    operation: "skip",
    outcome: "skipped",
    warnings: ["A newer copy is already stored."],
  };
}

function sourceIds() {
  return {
    dataSourceId: process.env.NOTION_PROJECTS_DATA_SOURCE_ID,
    databaseId: process.env.NOTION_PROJECTS_DATABASE_ID,
  };
}

function reviewResult(notionPageId: string, warning: string): SyncResult {
  return {
    notionPageId,
    operation: "review",
    outcome: "ok",
    warnings: [warning],
  };
}

function logResult(result: SyncResult) {
  console.info(
    JSON.stringify({
      scope: "portfolio-sync",
      notionPageId: result.notionPageId,
      operation: result.operation,
      outcome: result.outcome,
      errorCategory: result.errorCategory,
    }),
  );
}

