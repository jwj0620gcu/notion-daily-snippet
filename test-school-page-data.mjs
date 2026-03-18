import "dotenv/config";

const DATE = "2026-03-17";

async function main() {
  const url = new URL(`${process.env.SCHOOL_API_BASE_URL}/daily-snippets/page-data`);
  url.searchParams.set("date", DATE);

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${process.env.SCHOOL_API_TOKEN}`,
    },
  });

  const text = await res.text();

  console.log("status:", res.status);
  console.log("body:", text);
}

main().catch(console.error);