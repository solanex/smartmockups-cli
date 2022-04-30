#!/usr/bin/env node

require('dotenv').config();
const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');
const { v4 } = require('uuid'); 
const chokidar = require('chokidar');
const { program } = require('commander');

program.version('0.0.3')
       .requiredOption('-i, --input <png>', 'input png file to send to SmartMockups')
       .requiredOption('-m, --mockups <mockup...>', '(multiple) mockup slugs to create')
       .option('-o, --output <path>', 'output path to save mockups')
       .option('-v, --verbose', 'be verbose')
       .option('-fg --foreground', 'show the browser running (needs window manager)')
       .parse();

const options = program.opts();
const design = options.input;
const mockups = options.mockups;
const output = (options.output) ? options.output + '/' : '';
const headless = !options.foreground;
const verbose = options.verbose;

const tmpdir = process.env.TMP || '/tmp';

const result = [];

(async ()=>{
    const browser = await puppeteer.launch({
        headless,
        args: ['--start-maximized'],
        defaultViewport: null,
        userDataDir: './puppeteer_data'
    });
    const page = await browser.newPage();
    await page.setViewport({
        width: 1920,
        height: 1080,
    });
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.4324.192 Safari/537.36');

    //load cookies
    if (process.env.SMARTMOCKUPS_USECOOKIE) {
        try {
            const cookiesString = await fs.readFile('./.smartmockupscookies.json');
            const cookies = JSON.parse(cookiesString);
             await page.setCookie(...cookies);
        } catch (e) {
            //file doesn't exist ?
        }
    }

    //try to go the basepage
    await page.goto(process.env.SMARTMOCKUPS_BASEURL + '/mockups');
    await page.waitForTimeout(1000);

    //check if there is a login button
    let loginBtn = await page.$('button.NoUserLogin_btn__1cP35');
    if (loginBtn)
        await login(page);

    for (mockup of mockups)
        await doMockup(page, mockup)

    await browser.close();
    console.log(JSON.stringify(result));
    process.exit(1);

})();

const login = async (page) => {
    await page.click('button.NoUserLogin_btn__1cP35');
    await page.waitForTimeout(2000);
    await page.waitForSelector('form input[type="email"]');

    await page.focus('form input[type="email"]');
    await page.keyboard.type(process.env.SMARTMOCKUPS_LOGIN);

    await page.focus('form input[type="password"]');
    await page.keyboard.type(process.env.SMARTMOCKUPS_PASSWORD);

    await page.click('div.Login_loginButton__1IlgB button');
    //await page.waitForNavigation();
    await page.waitForTimeout(5000);

    //save our cookies for reuse later
    if (process.env.SMARTMOCKUPS_USECOOKIE) {
        const cookies = await page.cookies();
        await fs.writeFile('./.smartmockupscookies.json', JSON.stringify(cookies, null, 2));
    }
}

const doMockup = (page, mockup) => {
    return new Promise(async resolve => {
        await page.goto(process.env.SMARTMOCKUPS_BASEURL + '/mockup/' + mockup);
        await page.waitForTimeout(2000);
        await page.waitForSelector('span[data-cy="uploadFromBtn"]')

        await page.click('span[data-cy="uploadFromBtn"]');
        await page.waitForTimeout(2000);

        let fileInput = await page.$('input[data-cy="fileUploadBtn"]');
        await fileInput.uploadFile(design);
        await page.waitForTimeout(5000);

        await page.click('div.download-options-dropdown button');
        await page.waitForTimeout(2000);

        let downloadPath = tmpdir + '/' + v4();
        await fs.mkdir(downloadPath, err => {(err == null) || console.log(err)});

        const client = await page.target().createCDPSession();
        await client.send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath,
        });

        let watcher = chokidar.watch(downloadPath, {
            ignored: [/^\./, '*.crdownload'], 
            persistent: true,
            awaitWriteFinish: true,
        });

        watcher.on('add', async dlfile => {
            let nicename = output + path.parse(design).name + '-' + mockup + path.extname(dlfile);
            verbose && console.log('downloaded', dlfile, nicename);
            await fs.rename(dlfile, nicename);
            await fs.rmdir(downloadPath);
            result.push(nicename);
            await page.waitForTimeout(2000);
            await watcher.close();
            resolve();
        })

        await page.click('button[value="superHigh"]');
    });
}