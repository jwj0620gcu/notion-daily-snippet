import "dotenv/config";
import { Client } from "@notionhq/client";

const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

function getSnippetDateKST() {
  const now = new Date();

  const kstNow = new Date(
    now.toLocaleString("en-US", { timeZone: "Asia/Seoul" })
  );

  if (kstNow.getHours() < 9) {
    kstNow.setDate(kstNow.getDate() - 1);
  }

  const year = kstNow.getFullYear();
  const month = String(kstNow.getMonth() + 1).padStart(2, "0");
  const day = String(kstNow.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getTitle(page) {
  if (!page.properties) return "";

  for (const key of Object.keys(page.properties)) {
    const prop = page.properties[key];
    if (prop?.type === "title") {
      return (prop.title || []).map((t) => t.plain_text).join("");
    }
  }

  return "";
}

async function main() {
  const today = getSnippetDateKST();
  console.log("검색 날짜:", today);

  const res = await notion.search({
    query: today,
    filter: {
      property: "object",
      value: "page",
    },
    sort: {
      direction: "descending",
      timestamp: "last_edited_time",
    },
  });

  console.log("검색 결과 수:", res.results.length);

  const pages = res.results.filter((page) => {
    if (page.object !== "page") return false;
    return getTitle(page) === today;
  });

  console.log("찾은 페이지 수:", pages.length);

  for (const page of pages) {
    console.log("page id:", page.id);
    console.log("title:", getTitle(page));
    console.log("parent:", page.parent);
  }
}

main().catch(console.error);