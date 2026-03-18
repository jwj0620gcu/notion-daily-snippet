import "dotenv/config";

async function main() {
  const res = await fetch(`${process.env.SCHOOL_API_BASE_URL}/snippet_date`, {
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