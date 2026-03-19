import "dotenv/config";
import { Client } from "@notionhq/client";

const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});
const GEMINI_MODELS = (
  process.env.GEMINI_MODELS || "gemini-2.5-flash,gemini-2.5-flash-lite"
)
  .split(",")
  .map((model) => model.trim())
  .filter(Boolean);

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

async function getSnippetDate() {
  const res = await fetch(`${process.env.SCHOOL_API_BASE_URL}/snippet_date`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${process.env.SCHOOL_API_TOKEN}`,
    },
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`snippet_date 조회 실패: ${res.status} / ${text}`);
  }

  const data = JSON.parse(text);
  return data.date;
}

async function findPageByDate(targetDate) {
  const res = await notion.search({
    query: targetDate,
    filter: {
      property: "object",
      value: "page",
    },
    sort: {
      direction: "descending",
      timestamp: "last_edited_time",
    },
  });

  const pages = res.results.filter((page) => {
    if (page.object !== "page") return false;
    return getTitle(page) === targetDate;
  });

  if (pages.length === 0) {
    throw new Error(`노션에서 "${targetDate}" 페이지를 찾지 못했습니다.`);
  }

  if (process.env.NOTION_PARENT_PAGE_ID) {
    const matched = pages.find((page) => {
      return (
        page.parent?.type === "page_id" &&
        page.parent.page_id === process.env.NOTION_PARENT_PAGE_ID
      );
    });

    if (matched) return matched;
  }

  return pages[0];
}

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
      return "```\n" + richTextToPlainText(block.code.rich_text) + "\n```";
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

async function getPageData(date) {
  const url = new URL(
    `${process.env.SCHOOL_API_BASE_URL}/daily-snippets/page-data`,
  );
  url.searchParams.set("date", date);

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${process.env.SCHOOL_API_TOKEN}`,
    },
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`page-data 조회 실패: ${res.status} / ${text}`);
  }

  return JSON.parse(text);
}

async function updateSnippet(snippetId, content) {
  const res = await fetch(
    `${process.env.SCHOOL_API_BASE_URL}/daily-snippets/${snippetId}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.SCHOOL_API_TOKEN}`,
      },
      body: JSON.stringify({ content }),
    },
  );

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`스니펫 수정 실패: ${res.status} / ${text}`);
  }

  return safeJson(text);
}

async function createSnippet(content) {
  const res = await fetch(`${process.env.SCHOOL_API_BASE_URL}/daily-snippets`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.SCHOOL_API_TOKEN}`,
    },
    body: JSON.stringify({ content }),
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`스니펫 생성 실패: ${res.status} / ${text}`);
  }

  return safeJson(text);
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractJsonObject(text) {
  if (!text) {
    throw new Error("Gemini 응답이 비어 있습니다.");
  }

  const trimmed = text.trim();

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return JSON.parse(trimmed);
  }

  const fencedMatch = trimmed.match(/```json\s*([\s\S]*?)\s*```/i);
  if (fencedMatch) {
    return JSON.parse(fencedMatch[1]);
  }

  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    return JSON.parse(objectMatch[0]);
  }

  throw new Error("Gemini 응답에서 JSON을 찾지 못했습니다.");
}

function getResponseText(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts
    .map((part) => part.text || "")
    .join("")
    .trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryGemini(status) {
  return status === 429 || status === 500 || status === 503;
}

async function requestGemini(model, prompt) {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature: 0.5,
            responseMimeType: "application/json",
          },
        }),
      },
    );

    const text = await res.text();

    if (res.ok) {
      return JSON.parse(text);
    }

    if (!shouldRetryGemini(res.status) || attempt === maxAttempts) {
      throw new Error(`Gemini 생성 실패 (${model}): ${res.status} / ${text}`);
    }

    await sleep(attempt * 1500);
  }
}

async function generateSnippetContent(sourceText, snippetDate) {
  if (!process.env.GEMINI_API_KEY) {
    return sourceText;
  }

  const prompt = [
    `입력된 노션 데일리 메모를 바탕으로 ${snippetDate}의 데일리 회고를 작성해라.`,
    "입력은 짧고 거칠 수 있지만, 과장하지 말고 입력에 없는 사실은 만들지 마라.",
    "출력은 반드시 JSON 객체 하나만 반환해라.",
    "태스크별로 '오늘 한 일 / 하이라이트 / 로우라이트 / 내일의 우선순위'를 각각 반복해서 쓰지 말아라.",
    "반드시 하루 전체 기준으로 회고를 통합해서 작성해라.",
    "즉, '오늘 한 일' 섹션 아래에 여러 태스크를 한 번에 묶어 정리하고, '하이라이트'도 하루 전체 관점에서 중요한 내용만 종합해서 정리해라.",
    "로우라이트, 내일의 우선순위, 오늘 내가 팀에 기여한 가치, 오늘의 배움 또는 남길 말도 각각 하루 전체 기준으로 통합 작성해라.",
    "태스크별 개별 소제목은 만들지 마라.",
    "같은 형식 문장을 반복하지 말고, 비슷한 내용은 묶어서 자연스럽게 정리해라.",
    "하이라이트와 로우라이트는 하루에서 중요도가 높은 것만 1~3개 정도로 추려서 작성해라.",
    "문체는 노션 데일리 기록에 맞게 간결하지만 의미 있게 작성해라.",
    "각 필드는 모두 한국어 문자열로 작성해라.",
    "각 항목은 키워드가 아니라 의미 있는 문장 단위로 구체적으로 작성해라.",
    "입력에 없는 사실은 지어내지 말고, 추론이 필요하면 보수적으로 작성해라.",
    "lowlight는 부족한 점이나 개선 필요 사항을 보수적으로 작성해라. 명확한 문제가 없으면 '특별한 로우라이트 없음'처럼 정직하게 작성해라.",
    "team_value는 오늘 팀에 준 기여를 협업 관점에서 작성해라. 없으면 개인 준비가 팀에 어떻게 연결되는지 보수적으로 작성해라.",
    "learning_or_note는 오늘의 배움이나 남길 말을 한두 문장으로 작성해라.",
    'health_score는 1부터 10 사이의 정수로 작성해라.',
    "JSON 키는 다음만 사용해라: today_work, purpose, highlight, lowlight, tomorrow_priority, team_value, learning_or_note, health_score",
    "",
    "[노션 원문 시작]",
    sourceText,
    "[노션 원문 끝]",
  ].join("\n");

  let data;
  let lastError;

  for (const model of GEMINI_MODELS) {
    try {
      data = await requestGemini(model, prompt);
      console.log(`Gemini 스니펫 생성 완료 (${model})`);
      break;
    } catch (err) {
      lastError = err;
      console.warn(`${model} 실패, 다음 모델 시도`);
    }
  }

  if (!data) {
    throw lastError || new Error("Gemini 생성 실패");
  }

  const responseText = getResponseText(data);
  const parsed = extractJsonObject(responseText);
  const healthScore = Number(parsed.health_score);
  return [
    `## 오늘 한 일`,
    `- ${parsed.today_work || ""}`,
    ``,
    `## 수행 목적`,
    `- ${parsed.purpose || ""}`,
    ``,
    `## 하이라이트`,
    `- ${parsed.highlight || ""}`,
    ``,
    `## 로우라이트`,
    `- ${parsed.lowlight || ""}`,
    ``,
    `## 내일의 우선순위`,
    `- ${parsed.tomorrow_priority || ""}`,
    ``,
    `## 오늘 내가 팀에 기여한 가치`,
    `- ${parsed.team_value || ""}`,
    ``,
    `## 오늘의 배움 또는 남길 말`,
    `- ${parsed.learning_or_note || ""}`,
    ``,
    `## 헬스 체크 (10점)`,
    `- ${Number.isFinite(healthScore) ? Math.min(10, Math.max(1, Math.round(healthScore))) : ""}/10`,
  ].join("\n");
}

async function main() {
  const snippetDate = await getSnippetDate();
  console.log("스니펫 기준 날짜:", snippetDate);

  const page = await findPageByDate(snippetDate);
  console.log("찾은 노션 페이지:", getTitle(page));

  const notionText = await readPageText(page.id);

  if (!notionText.trim()) {
    throw new Error("노션 페이지 본문이 비어 있습니다.");
  }

  const snippetContent = await generateSnippetContent(notionText, snippetDate);
  if (!process.env.GEMINI_API_KEY) {
    console.log("GEMINI_API_KEY 없음 → 원문 그대로 사용");
  }

  const pageData = await getPageData(snippetDate);

  let result;

  if (pageData?.snippet?.id) {
    const snippetId = pageData.snippet.id;
    console.log("기존 스니펫 발견:", snippetId);
    result = await updateSnippet(snippetId, snippetContent);
    console.log("기존 스니펫 수정 완료");
  } else {
    console.log("기존 스니펫 없음 → 새로 생성");
    result = await createSnippet(snippetContent);
    console.log("새 스니펫 생성 완료");
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("\n오류 발생:");
  console.error(err.message);
});
