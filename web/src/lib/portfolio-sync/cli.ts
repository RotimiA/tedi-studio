import {isNotionPageId} from "./map-project.ts";
import {syncProjects} from "./sync.ts";

const pageId = process.argv[2];

if (pageId && !isNotionPageId(pageId)) {
  console.error("pageId must be a Notion page ID.");
  process.exit(1);
}

const results = await syncProjects(pageId ? {pageId} : {});
console.log(JSON.stringify(results, null, 2));

if (results.some((result) => result.outcome === "error")) {
  process.exit(1);
}
