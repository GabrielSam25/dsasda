import chromium from "@sparticuz/chromium-min";
import { chromium as playwright } from "playwright-core";

export default async function handler(req, res) {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ error: "Falta o parâmetro ?url=" });
    }

    // Caminho do Chromium compatível com serverless
    const executablePath = await chromium.executablePath();

    // Lançando o navegador headless
    const browser = await playwright.launch({
      args: chromium.args,
      executablePath,
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle" });

    // Pegando o HTML renderizado
    const content = await page.content();

    await browser.close();

    res.status(200).json({ html: content });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao processar scrape" });
  }
}
