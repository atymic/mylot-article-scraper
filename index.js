const puppeteer = require('puppeteer')
const axios = require('axios')
const cheerio = require('cheerio')
const async = require('async')
const fs = require('fs')
const slugify = require('slugify')
const { DateTime } = require('luxon')

class Mylot {
  static async generatePagePDF (article, force = false) {
    const browser = await puppeteer.launch({ headless: true })
    const page = await browser.newPage()
    await page.goto(article.url, { waitUntil: 'networkidle0' })

    const name = await page.$eval('#discTit', el => el.innerText)
    const slug = slugify(name)

    const dateRaw = await page.$eval('#discDat', el => el.innerText)
    const dateFormatted = DateTime.fromFormat(dateRaw.replace(' CST', ''), 'MMMM d, yyyy h:ma').toISODate()

    const filename = `out/${dateFormatted}-${slug}.pdf`

    if (fs.existsSync(filename) && !force) {
      console.info(`PDF for article ${article.url} already exists, skipping`)
      return
    }

    // Cheat the ajax comment loading to load everything in one go
    await page.evaluate(() => {
      window.discussionResponseCount = 1000 &&
        window.getDiscussionFull(window.discussionId, window.responseId, window.commentId, window.responseStartRow)
    })

    // Hide annoying UI bits
    await page.evaluate(() => {
      document.querySelector('#top-container').style.display = 'none'
      document.querySelector('#discSoc').style.display = 'none'
    })

    await page.waitForTimeout(3000)

    const pdfConfig = {
      path: filename,
      format: 'A4',
      printBackground: true,
      margin: {
        top: '1cm',
        bottom: '1cm',
        left: '1cm',
        right: '1cm',
      },
    }
    await page.emulateMediaType('screen')
    await page.pdf(pdfConfig)

    await browser.close()
  }
}

const extractArticles = r$ => {
  let urls = []

  const articles = r$('.atvDiscTit a').each(function () {
    urls.push({ url: 'https://www.mylot.com' + r$(this).attr('href'), name: r$(this).text().trim() })
  })

  return urls
}

const getStartAction = html => {
  const match = html.match(/startActionId = "(\d+)"/)

  if (match) {
    return match[1]
  }

  return null
}

(async () => {
  const args = process.argv.slice(2)

  let articles = []

  const res = await axios.get(`https://www.mylot.com/${args[0]}/posts`)
  const r$ = cheerio.load(res.data)

  let startAction = getStartAction(res.data)
  articles = articles.concat(extractArticles(r$))

  do {
    const url = `https://www.mylot.com/atv/more?activityTypeId=103&startActionId=${startAction}&tagname=&username=${args[0]}&_=${(new Date()).getTime()}`
    console.log(`Getting URL ${url}, Articles Count: ${articles.length}`)

    const res = await axios.get(url)
    const r$ = cheerio.load(res.data)

    startAction = getStartAction(res.data)
    articles = articles.concat(extractArticles(r$))
  } while (startAction)

  await async.mapLimit(articles, 5, async article => {
    console.info(`PDFing URL ${article.url}`)
    try {
      await Mylot.generatePagePDF(article)
    } catch (e) {
      console.error(`Error PDFing with URL ${article.url}, ${e.toString()}`)
    }
  })
})()
