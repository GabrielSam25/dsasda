const { chromium: playwright } = require("playwright-core");
const chromium = require("@sparticuz/chromium");

module.exports = async (req, res) => {
  try {
    const browser = await playwright.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });

    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("https://example.com");
    const pageTitle = await page.title();
    await browser.close();

    res.status(200).json({
      success: true,
      title: pageTitle,
      message: "Test completed successfully"
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};
