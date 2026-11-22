import {SyncError} from "./errors.ts";
import type {NotionBlock, NotionPage} from "./map-project.ts";

const NOTION_VERSION = "2025-09-03";
const MAX_BLOCKS = 300;
const MAX_DEPTH = 4;

type NotionList = {
  results?: NotionBlock[];
  has_more?: boolean;
  next_cursor?: string | null;
};

type NotionPageList = {
  results?: NotionPage[];
  has_more?: boolean;
  next_cursor?: string | null;
};

export async function listProjectPages() {
  const dataSourceId = requiredEnv("NOTION_PROJECTS_DATA_SOURCE_ID");
  const pages: NotionPage[] = [];
  let cursor: string | undefined;

  do {
    const data = await notionRequest<NotionPageList>(
      `/data_sources/${dataSourceId}/query`,
      {
        method: "POST",
        body: JSON.stringify({
          page_size: 100,
          ...(cursor ? {start_cursor: cursor} : {}),
        }),
      },
    );
    pages.push(...(data.results ?? []));
    cursor = data.has_more ? data.next_cursor ?? undefined : undefined;
  } while (cursor);

  return pages;
}

export async function getProjectPage(pageId: string) {
  try {
    return await notionRequest<NotionPage>(`/pages/${pageId}`);
  } catch (error) {
    if (error instanceof SyncError && error.category === "not_found") return null;
    throw error;
  }
}

export async function listPageBlocks(pageId: string) {
  const blocks: NotionBlock[] = [];
  const truncated = await walk(pageId, 0, blocks);
  return {blocks, truncated};
}

async function walk(blockId: string, depth: number, blocks: NotionBlock[]) {
  if (depth > MAX_DEPTH) return true;
  let cursor: string | undefined;

  do {
    const query = new URLSearchParams({page_size: "100"});
    if (cursor) query.set("start_cursor", cursor);
    const data = await notionRequest<NotionList>(
      `/blocks/${blockId}/children?${query.toString()}`,
    );

    for (const block of data.results ?? []) {
      blocks.push(block);
      if (blocks.length > MAX_BLOCKS) return true;
      if (block.has_children && canRecurse(block.type)) {
        const truncated = await walk(block.id, depth + 1, blocks);
        if (truncated) return true;
      }
    }

    cursor = data.has_more ? data.next_cursor ?? undefined : undefined;
  } while (cursor);

  return false;
}

function canRecurse(type: string) {
  return (
    type !== "child_database" &&
    type !== "child_page" &&
    type !== "link_to_page" &&
    type !== "synced_block" &&
    type !== "table" &&
    type !== "unsupported"
  );
}

async function notionRequest<T>(path: string, init?: RequestInit, attempt = 0): Promise<T> {
  const token = requiredEnv("NOTION_TOKEN");
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    signal: AbortSignal.timeout(20_000),
  });

  if ((response.status === 429 || response.status === 503) && attempt < 3) {
    const retryAfter = Number(response.headers.get("retry-after") ?? "1");
    const seconds = Number.isFinite(retryAfter) ? Math.min(Math.max(retryAfter, 1), 10) : 1;
    await delay(seconds * 1000);
    return notionRequest(path, init, attempt + 1);
  }

  if (!response.ok) {
    const category =
      response.status === 404
        ? "not_found"
        : response.status === 401 || response.status === 403
          ? "auth"
          : "notion";
    throw new SyncError(`Notion request failed (${response.status}).`, category);
  }

  return (await response.json()) as T;
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new SyncError(`${name} is not configured.`, "config");
  return value;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
