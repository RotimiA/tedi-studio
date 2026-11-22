import {createClient} from "next-sanity";
import {SyncError} from "../lib/portfolio-sync/errors.ts";

export function writeClient() {
  const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
  const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET;
  const token = process.env.SANITY_API_WRITE_TOKEN;

  if (!projectId || !dataset || !token) {
    throw new SyncError("Sanity write access is not configured.", "config");
  }

  return createClient({
    projectId,
    dataset,
    apiVersion: "2026-11-07",
    token,
    useCdn: false,
  });
}
