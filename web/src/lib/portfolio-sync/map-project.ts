export type RichText = {
  plain_text?: string;
  href?: string | null;
  text?: {content?: string; link?: {url?: string} | null};
  annotations?: {
    bold?: boolean;
    italic?: boolean;
    strikethrough?: boolean;
    underline?: boolean;
    code?: boolean;
  };
};

export type NotionBlock = {
  id: string;
  type: string;
  has_children?: boolean;
  heading_1?: {rich_text?: RichText[]};
  heading_2?: {rich_text?: RichText[]};
  heading_3?: {rich_text?: RichText[]};
  paragraph?: {rich_text?: RichText[]};
  bulleted_list_item?: {rich_text?: RichText[]};
  numbered_list_item?: {rich_text?: RichText[]};
  quote?: {rich_text?: RichText[]};
  image?: {
    caption?: RichText[];
    file?: {url?: string};
    external?: {url?: string};
  };
};

export type NotionProperty = {
  type?: string;
  title?: RichText[];
  rich_text?: RichText[];
  select?: {name?: string} | null;
  multi_select?: Array<{name?: string}>;
  status?: {name?: string} | null;
  url?: string | null;
  date?: {start?: string | null; end?: string | null} | null;
  files?: Array<{
    name?: string;
    file?: {url?: string};
    external?: {url?: string};
  }>;
};

export type NotionPage = {
  id: string;
  last_edited_time?: string;
  archived?: boolean;
  in_trash?: boolean;
  parent?: {
    type?: string;
    database_id?: string;
    data_source_id?: string;
  };
  properties?: Record<string, NotionProperty>;
};

export type PendingImage = {
  url: string;
  filename: string;
  alt: string;
};

export type TextBlock = {
  _type: "block";
  _key: string;
  style: "normal" | "h2" | "h3" | "h4" | "blockquote";
  listItem?: "bullet" | "number";
  level?: number;
  markDefs: Array<{_key: string; _type: "link"; href: string}>;
  children: Array<{
    _type: "span";
    _key: string;
    text: string;
    marks: string[];
  }>;
};

export type ImageBlock = {
  _type: "image";
  _key: string;
  alt: string;
  _pending: PendingImage;
};

export type PlannedDocument = {
  notionPageId: string;
  sourceUpdatedAt: string;
  portfolioStatus: "draft" | "readyForReview" | "published" | "unpublished";
  title: string;
  slug?: {_type: "slug"; current: string};
  summary?: string;
  description?: string;
  objective?: string;
  role?: string;
  disciplines: string[];
  tools: string[];
  deliverablesText?: string;
  outcomesText?: string;
  projectStatus?: string;
  startDate?: string;
  endDate?: string;
  projectUrl?: string;
  hero?: PendingImage;
  body: Array<TextBlock | ImageBlock>;
};

export type SyncPlan = {
  notionPageId: string;
  sourceUpdatedAt?: string;
  warnings: string[];
  action: "publish" | "draft" | "unpublish" | "withhold" | "reject";
  document?: PlannedDocument;
  errors?: string[];
};

const PRIVATE_HEADING =
  /\b(tasks?|docs?|documents?|clients?|internal|private)\b/i;
const PORTFOLIO_HEADING = /^portfolio case study$/i;
const STRUCTURAL_BLOCKS = new Set(["column_list", "column"]);

export function isNotionPageId(value: string) {
  return (
    /^[0-9a-f]{32}$/i.test(value) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

export function pageInSource(
  page: NotionPage,
  ids: {dataSourceId?: string; databaseId?: string},
) {
  const parent = page.parent;
  if (!parent) return false;
  return (
    sameId(parent.data_source_id, ids.dataSourceId) ||
    sameId(parent.database_id, ids.databaseId)
  );
}

function sameId(left?: string, right?: string) {
  if (!left || !right) return false;
  return left.replaceAll("-", "").toLowerCase() === right.replaceAll("-", "").toLowerCase();
}

export function isCurrentOrNewer(existing: string | undefined, incoming: string) {
  if (!existing) return true;
  const previous = Date.parse(existing);
  const next = Date.parse(incoming);
  if (Number.isNaN(next)) return false;
  if (Number.isNaN(previous)) return true;
  return next >= previous;
}

export function toSourceProject(page: NotionPage, blocks: NotionBlock[]) {
  const properties = page.properties ?? {};
  return {
    page,
    title: readText(properties.Title),
    slug: readText(properties.Slug),
    summary: readText(properties.Summary),
    description: readText(properties.Description),
    objective: readText(properties["Problem/Objective"]),
    role: readSelect(properties.Role),
    disciplines: readMulti(properties.Type),
    tools: readMulti(properties["Tools & Technologies"]),
    deliverablesText: readText(properties.Deliverables),
    outcomesText: readText(properties["Outcomes / Results"]),
    projectStatus: readStatus(properties.Status),
    projectUrl: readUrl(properties.URL),
    startDate: readDate(properties.Dates?.date?.start),
    endDate: readDate(properties.Dates?.date?.end),
    portfolioStatus: readSelect(properties["Portfolio Status"]),
    hero: readHero(properties["Hero Image"]),
    blocks,
  };
}

export function planProject(
  page: NotionPage,
  blocks: NotionBlock[],
): SyncPlan {
  const source = toSourceProject(page, blocks);
  const warnings: string[] = [];
  const portfolioStatus = normalizeStatus(source.portfolioStatus);

  if (portfolioStatus === "draft") {
    return basePlan(page, "withhold", warnings);
  }

  if (portfolioStatus === "unknown") {
    warnings.push("Unknown Portfolio Status was kept off the website.");
    return basePlan(page, "withhold", warnings);
  }

  const document = buildDocument(
    source,
    portfolioStatus,
    convertBlocks(source.blocks, warnings),
  );

  if (portfolioStatus === "published") {
    const errors = validatePublication(source, document);
    if (errors.length > 0) {
      return {...basePlan(page, "reject", warnings), errors};
    }
    return {...basePlan(page, "publish", warnings), document};
  }

  if (portfolioStatus === "readyForReview") {
    return {...basePlan(page, "draft", warnings), document};
  }

  return {...basePlan(page, "unpublish", warnings), document};
}

function basePlan(
  page: NotionPage,
  action: SyncPlan["action"],
  warnings: string[],
): SyncPlan {
  return {
    notionPageId: page.id,
    sourceUpdatedAt: page.last_edited_time,
    action,
    warnings,
  };
}

function buildDocument(
  source: ReturnType<typeof toSourceProject>,
  portfolioStatus: PlannedDocument["portfolioStatus"],
  body: Array<TextBlock | ImageBlock>,
): PlannedDocument {
  const slug = source.slug.trim();
  return {
    notionPageId: source.page.id,
    sourceUpdatedAt: source.page.last_edited_time ?? "",
    portfolioStatus,
    title: source.title.trim() || "Untitled",
    slug: isValidSlug(slug) ? {_type: "slug", current: slug} : undefined,
    summary: emptyToUndefined(source.summary),
    description: emptyToUndefined(source.description),
    objective: emptyToUndefined(source.objective),
    role: emptyToUndefined(source.role),
    disciplines: source.disciplines,
    tools: source.tools,
    deliverablesText: emptyToUndefined(source.deliverablesText),
    outcomesText: emptyToUndefined(source.outcomesText),
    projectStatus: emptyToUndefined(source.projectStatus),
    startDate: source.startDate,
    endDate: source.endDate,
    projectUrl: publicHttpUrl(source.projectUrl),
    hero: source.hero ?? undefined,
    body,
  };
}

function validatePublication(
  source: ReturnType<typeof toSourceProject>,
  document: PlannedDocument,
) {
  const errors: string[] = [];
  if (!source.title.trim()) errors.push("A title is required before publishing.");
  if (!source.slug.trim()) errors.push("A slug is required before publishing.");
  else if (!isValidSlug(source.slug.trim())) {
    errors.push("Slug must use lowercase letters, numbers, and hyphens.");
  }
  if (source.projectUrl.trim() && !document.projectUrl) {
    errors.push("Project URL must be a public http(s) address.");
  }
  if (!hasNarrative(document.body)) {
    errors.push("Add a case study before publishing.");
  }
  if (!source.page.last_edited_time) {
    errors.push("Notion did not provide a last-edited time.");
  }
  return errors;
}

function hasNarrative(body: Array<TextBlock | ImageBlock>) {
  return body.some((block) => {
    if (block._type === "image") return true;
    if (block.style.startsWith("h")) return false;
    return block.children.some((child) => child.text.trim());
  });
}

function convertBlocks(blocks: NotionBlock[], warnings: string[]) {
  const selected = selectPublishableBlocks(blocks, warnings);
  const converted = selected.flatMap((block, index) =>
    convertBlock(block, index, warnings),
  );
  return dropEmptySections(converted);
}

function selectPublishableBlocks(blocks: NotionBlock[], warnings: string[]) {
  const hasPortfolioSection = blocks.some((block) => {
    const heading = headingOf(block);
    return heading ? PORTFOLIO_HEADING.test(heading.text) : false;
  });
  let include = !hasPortfolioSection;
  const selected: NotionBlock[] = [];

  for (const block of blocks) {
    if (
      block.type === "child_database" ||
      block.type === "child_page" ||
      block.type === "link_to_page" ||
      block.type === "synced_block"
    ) {
      warnings.push(`Skipped a ${block.type.replaceAll("_", " ")}.`);
      continue;
    }

    const heading = headingOf(block);
    if (heading) {
      const isMajor = heading.level <= 2;
      if (hasPortfolioSection && isMajor) {
        include = PORTFOLIO_HEADING.test(heading.text);
      } else if (PRIVATE_HEADING.test(heading.text)) {
        include = false;
      } else if (!hasPortfolioSection && isMajor) {
        include = true;
      }
    }

    if (!include || STRUCTURAL_BLOCKS.has(block.type)) continue;
    if (heading && PRIVATE_HEADING.test(heading.text)) continue;
    if (heading && PORTFOLIO_HEADING.test(heading.text)) continue;
    selected.push(block);
  }

  return selected;
}

function convertBlock(
  block: NotionBlock,
  index: number,
  warnings: string[],
): Array<TextBlock | ImageBlock> {
  const key = block.id || `block-${index}`;

  if (block.type === "image") {
    const url = block.image?.file?.url || block.image?.external?.url;
    if (!url) return [];
    const alt = plain(block.image?.caption).trim();
    return [
      {
        _type: "image",
        _key: key,
        alt,
        _pending: {
          url,
          filename: filenameFrom(undefined, url, `${key}.jpg`),
          alt,
        },
      },
    ];
  }

  const style = styleOf(block.type);
  const listItem = listItemOf(block.type);
  if (!style && !listItem) {
    warnings.push(`Skipped an unsupported ${block.type} block.`);
    return [];
  }

  const rich = richTextOf(block);
  const spans = toSpans(rich, key, warnings);
  if (spans.children.length === 0) return [];

  return [
    {
      _type: "block",
      _key: key,
      style: style ?? "normal",
      ...(listItem ? {listItem, level: 1} : {}),
      markDefs: spans.markDefs,
      children: spans.children,
    },
  ];
}

function dropEmptySections(blocks: Array<TextBlock | ImageBlock>) {
  const sections: Array<Array<TextBlock | ImageBlock>> = [];
  let current: Array<TextBlock | ImageBlock> = [];

  for (const block of blocks) {
    if (block._type === "block" && block.style.startsWith("h") && current.length > 0) {
      sections.push(current);
      current = [];
    }
    current.push(block);
  }
  if (current.length > 0) sections.push(current);

  return sections.flatMap((section) => (sectionHasContent(section) ? section : []));
}

function sectionHasContent(section: Array<TextBlock | ImageBlock>) {
  return section.some((block) => {
    if (block._type === "image") return true;
    if (block.style.startsWith("h")) return false;
    return block.children.some((child) => child.text.trim());
  });
}

function toSpans(rich: RichText[] | undefined, key: string, warnings: string[]) {
  const children: TextBlock["children"] = [];
  const markDefs: TextBlock["markDefs"] = [];

  for (const [index, item] of (rich ?? []).entries()) {
    const text = item.plain_text ?? item.text?.content ?? "";
    if (!text) continue;
    const marks: string[] = [];
    if (item.annotations?.bold) marks.push("strong");
    if (item.annotations?.italic) marks.push("em");
    if (item.annotations?.code) marks.push("code");
    if (item.annotations?.underline) marks.push("underline");
    if (item.annotations?.strikethrough) marks.push("strike-through");

    const href = item.href || item.text?.link?.url || "";
    if (href) {
      if (isSafeHref(href)) {
        const markKey = `${key}-a${index}`;
        marks.push(markKey);
        markDefs.push({_key: markKey, _type: "link", href});
      } else {
        warnings.push("Removed an unsafe link.");
      }
    }

    children.push({
      _type: "span",
      _key: `${key}-s${index}`,
      text,
      marks,
    });
  }

  return {children, markDefs};
}

function headingOf(block: NotionBlock) {
  if (block.type === "heading_1") {
    return {level: 1 as const, text: plain(block.heading_1?.rich_text)};
  }
  if (block.type === "heading_2") {
    return {level: 2 as const, text: plain(block.heading_2?.rich_text)};
  }
  if (block.type === "heading_3") {
    return {level: 3 as const, text: plain(block.heading_3?.rich_text)};
  }
  return null;
}

function richTextOf(block: NotionBlock) {
  switch (block.type) {
    case "heading_1":
      return block.heading_1?.rich_text;
    case "heading_2":
      return block.heading_2?.rich_text;
    case "heading_3":
      return block.heading_3?.rich_text;
    case "paragraph":
      return block.paragraph?.rich_text;
    case "bulleted_list_item":
      return block.bulleted_list_item?.rich_text;
    case "numbered_list_item":
      return block.numbered_list_item?.rich_text;
    case "quote":
      return block.quote?.rich_text;
    default:
      return undefined;
  }
}

// The website title is the page heading, so Notion headings step down one level.
function styleOf(type: string): TextBlock["style"] | null {
  switch (type) {
    case "heading_1":
      return "h2";
    case "heading_2":
      return "h3";
    case "heading_3":
      return "h4";
    case "paragraph":
      return "normal";
    case "quote":
      return "blockquote";
    default:
      return null;
  }
}

function listItemOf(type: string): "bullet" | "number" | null {
  if (type === "bulleted_list_item") return "bullet";
  if (type === "numbered_list_item") return "number";
  return null;
}

function normalizeStatus(
  value: string,
): PlannedDocument["portfolioStatus"] | "unknown" {
  switch (value.trim().toLowerCase()) {
    case "draft":
    case "":
      return "draft";
    case "ready for review":
      return "readyForReview";
    case "published":
      return "published";
    case "unpublished":
      return "unpublished";
    default:
      return "unknown";
  }
}

function readText(property: NotionProperty | undefined) {
  if (!property) return "";
  if (property.type === "title") return plain(property.title);
  if (property.type === "rich_text") return plain(property.rich_text);
  return plain(property.title ?? property.rich_text);
}

function readSelect(property: NotionProperty | undefined) {
  return property?.select?.name?.trim() ?? "";
}

function readStatus(property: NotionProperty | undefined) {
  return property?.status?.name?.trim() ?? "";
}

function readMulti(property: NotionProperty | undefined) {
  return (property?.multi_select ?? [])
    .map((item) => item.name?.trim() ?? "")
    .filter(Boolean);
}

function readUrl(property: NotionProperty | undefined) {
  return property?.url?.trim() ?? "";
}

function readDate(value: string | null | undefined) {
  if (!value) return undefined;
  const date = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
}

function readHero(property: NotionProperty | undefined): PendingImage | null {
  const file = property?.files?.find((item) => item.file?.url || item.external?.url);
  const url = file?.file?.url || file?.external?.url;
  if (!file || !url) return null;
  return {
    url,
    filename: filenameFrom(file.name, url, "hero.jpg"),
    alt: "",
  };
}

function plain(rich: RichText[] | undefined) {
  return (rich ?? []).map((item) => item.plain_text ?? item.text?.content ?? "").join("");
}

function emptyToUndefined(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function isValidSlug(value: string) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function publicHttpUrl(value: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    if (!url.hostname || url.username || url.password) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function isSafeHref(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" || url.protocol === "mailto:";
  } catch {
    return false;
  }
}

function filenameFrom(name: string | undefined, url: string, fallback: string) {
  const fromUrl = url.split("?")[0]?.split("/").pop();
  const raw = name || fromUrl || fallback;
  const cleaned = raw.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 120);
  return cleaned || fallback;
}
