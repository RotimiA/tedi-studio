import assert from "node:assert/strict";
import test from "node:test";
import {planProject, type NotionBlock, type NotionPage} from "./map-project.ts";

function page(overrides: Partial<NotionPage> = {}): NotionPage {
  return {
    id: "269cf752-d448-810e-8fe5-d493c355e679",
    last_edited_time: "2026-11-07T10:39:04.747Z",
    properties: {
      Title: {type: "title", title: [{plain_text: "ODG Sports Entertainment"}]},
      Slug: {type: "rich_text", rich_text: [{plain_text: "odg-sports-entertainment"}]},
      Summary: {type: "rich_text", rich_text: [{plain_text: "A public summary."}]},
      "Portfolio Status": {type: "select", select: {name: "Published"}},
      Client: {type: "people"},
      Tasks: {type: "relation"},
      Docs: {type: "relation"},
      Content: {type: "rich_text", rich_text: [{plain_text: "Private content property."}]},
    },
    ...overrides,
  };
}

function text(value: string, annotations?: {bold?: boolean; italic?: boolean}) {
  return {plain_text: value, annotations, href: null};
}

test("published case studies omit task databases and private properties", () => {
  const blocks: NotionBlock[] = [
    {
      id: "tasks",
      type: "heading_2",
      heading_2: {rich_text: [text("Project tasks")]},
    },
    {id: "db", type: "child_database"},
    {
      id: "overview",
      type: "heading_2",
      heading_2: {rich_text: [text("Project Overview")]},
    },
    {
      id: "para",
      type: "paragraph",
      paragraph: {
        rich_text: [
          text("Public overview with "),
          {
            plain_text: "emphasis",
            annotations: {bold: true, italic: true},
            href: "https://example.com/case",
          },
          text("."),
        ],
      },
    },
    {
      id: "empty-item",
      type: "bulleted_list_item",
      bulleted_list_item: {rich_text: [text("")]},
    },
    {
      id: "item",
      type: "bulleted_list_item",
      bulleted_list_item: {rich_text: [text("A public point")]},
    },
    {
      id: "unsafe",
      type: "paragraph",
      paragraph: {
        rich_text: [{plain_text: "hidden", href: "javascript:alert(1)"}],
      },
    },
  ];

  const plan = planProject(page(), blocks);

  assert.equal(plan.action, "publish");
  assert.equal(plan.document?.slug?.current, "odg-sports-entertainment");
  assert.equal(plan.document?.summary, "A public summary.");
  assert.equal("Client" in (plan.document ?? {}), false);
  const serialized = JSON.stringify(plan.document);
  assert.equal(serialized.includes("Private content property"), false);
  assert.equal(serialized.includes("child_database"), false);
  assert.equal(serialized.includes("Project tasks"), false);
  assert.equal(serialized.includes("javascript:"), false);
  assert.match(serialized, /Public overview/);
  assert.match(serialized, /A public point/);
  assert.equal(plan.warnings.some((warning) => warning.includes("child database")), true);
  assert.equal(plan.warnings.some((warning) => warning.includes("unsafe")), true);

  const paragraph = plan.document?.body.find((block) => block._key === "para");
  assert.ok(paragraph && paragraph._type === "block");
  if (paragraph && paragraph._type === "block") {
    assert.deepEqual(paragraph.children[1]?.marks, ["strong", "em", "para-a1"]);
    assert.equal(paragraph.markDefs[0]?.href, "https://example.com/case");
  }
});

test("drafts are withheld and incomplete projects are rejected", () => {
  const draft = planProject(
    page({
      properties: {
        ...page().properties,
        "Portfolio Status": {type: "select", select: {name: "Draft"}},
      },
    }),
    [],
  );
  assert.equal(draft.action, "withhold");
  assert.equal(draft.document, undefined);

  const missing = planProject(
    page({
      properties: {
        Title: {type: "title", title: [{plain_text: "Untitled study"}]},
        "Portfolio Status": {type: "select", select: {name: "Published"}},
      },
    }),
    [],
  );
  assert.equal(missing.action, "reject");
  assert.ok(missing.errors?.some((error) => error.includes("slug")));
  assert.ok(missing.errors?.some((error) => error.includes("case study")));
});

test("a portfolio section is the only published body", () => {
  const blocks: NotionBlock[] = [
    {
      id: "notes",
      type: "paragraph",
      paragraph: {rich_text: [text("Working notes")]},
    },
    {
      id: "public",
      type: "heading_2",
      heading_2: {rich_text: [text("Portfolio Case Study")]},
    },
    {
      id: "story",
      type: "paragraph",
      paragraph: {rich_text: [text("The public story")]},
    },
  ];

  const plan = planProject(
    page({
      properties: {
        ...page().properties,
        "Portfolio Status": {type: "select", select: {name: "Ready for Review"}},
      },
    }),
    blocks,
  );

  assert.equal(plan.action, "draft");
  const serialized = JSON.stringify(plan.document?.body);
  assert.equal(serialized.includes("Working notes"), false);
  assert.match(serialized, /The public story/);
});

test("unpublishing keeps a document but does not require a case study", () => {
  const plan = planProject(
    page({
      properties: {
        Title: {type: "title", title: [{plain_text: "Paused"}]},
        "Portfolio Status": {type: "select", select: {name: "Unpublished"}},
      },
    }),
    [],
  );

  assert.equal(plan.action, "unpublish");
  assert.equal(plan.document?.portfolioStatus, "unpublished");
});
