import {defineQuery} from "next-sanity";

export const PROJECTS_QUERY = defineQuery(
  `*[_type == "project" && portfolioStatus == "published" && defined(slug.current)] | order(title asc) {
    _id,
    title,
    "slug": slug.current,
    summary,
    disciplines
  }`,
);

export const PROJECT_QUERY = defineQuery(
  `*[_type == "project" && portfolioStatus == "published" && slug.current == $slug][0]{
    _id,
    title,
    summary,
    description,
    objective,
    role,
    disciplines,
    tools,
    deliverablesText,
    outcomesText,
    startDate,
    endDate,
    projectUrl,
    mainImage,
    body
  }`,
);
