import "dotenv/config";
import { Client } from "@notionhq/client";

const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

const PAGE_ID = "3265f8fd-06a3-808d-878f-e7572f3c36eb";

async function readAllChildren(blockId) {
  let results = [];
  let cursor = undefined;

  while (true) {
    const res = await notion.blocks.children.list({
      block_id: blockId,
      start_cursor: cursor,
      page_size: 100,
    });

    results = results.concat(res.results);

    if (!res.has_more) break;
    cursor = res.next_cursor;
  }

  return results;
}

function richTextToPlainText(arr = []) {
  return arr.map((item) => item.plain_text || "").join("");
}

function blockToText(block) {
  switch (block.type) {
    case "paragraph":
      return richTextToPlainText(block.paragraph.rich_text);

    case "heading_1":
      return "# " + richTextToPlainText(block.heading_1.rich_text);

    case "heading_2":
      return "## " + richTextToPlainText(block.heading_2.rich_text);

    case "heading_3":
      return "### " + richTextToPlainText(block.heading_3.rich_text);

    case "bulleted_list_item":
      return "- " + richTextToPlainText(block.bulleted_list_item.rich_text);

    case "numbered_list_item":
      return "- " + richTextToPlainText(block.numbered_list_item.rich_text);

    case "to_do":
      return `${block.to_do.checked ? "[x]" : "[ ]"} ${richTextToPlainText(block.to_do.rich_text)}`;

    case "quote":
      return "> " + richTextToPlainText(block.quote.rich_text);

    case "callout":
      return richTextToPlainText(block.callout.rich_text);

    case "code":
      return richTextToPlainText(block.code.rich_text);

    case "divider":
      return "----------------";

    default:
      return "";
  }
}

async function readPageText(blockId, depth = 0) {
  const blocks = await readAllChildren(blockId);
  const lines = [];

  for (const block of blocks) {
    const text = blockToText(block);

    if (text.trim()) {
      lines.push("  ".repeat(depth) + text);
    }

    if (block.has_children) {
      const childText = await readPageText(block.id, depth + 1);
      if (childText.trim()) {
        lines.push(childText);
      }
    }
  }

  return lines.join("\n");
}

async function main() {
  const text = await readPageText(PAGE_ID);

  console.log("=== 노션 본문 시작 ===");
  console.log(text);
  console.log("=== 노션 본문 끝 ===");
}

main().catch(console.error);