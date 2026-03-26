import { gotScraping } from "got-scraping";
try {
  const res = await gotScraping("https://api.anthropic.com", { useHeaderGenerator: false, retry: { limit: 0 } });
  console.log("Status:", res.statusCode);
} catch (e) {
  console.log("Error:", e.message);
}
