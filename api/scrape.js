import { chromium } from "playwright-core";

export default async function handler(req, res) {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ error: "Falta o parâmetro ?url=" });
    }

    // Chromium compatível com Vercel (headless)
    const browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--single-process",
      ],
    });

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle" });

    const content = await page.content();

    await browser.close();

    res.status(200).json({ html: content });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao processar scrape" });
  }
}
