const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  const logs = [];
  page.on('console', msg => logs.push(msg.type() + ': ' + msg.text()));
  page.on('pageerror', err => logs.push('PAGEERROR: ' + err.message));
  try {
    await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForTimeout(3000);
    const html = await page.content();
    await page.screenshot({ path: 'D:/proj/geogebra/screenshot.png', fullPage: true });
    console.log('HTML length:', html.length);
    console.log('HTML snippet:', html.slice(0, 1000));
    console.log('Console logs:');
    for (const log of logs.slice(0, 50)) console.log(log);
  } catch (e) {
    console.log('ERROR:', e.message);
  }
  await browser.close();
})();
