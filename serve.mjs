import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/vendor/jszip.min.js', ['vendor/jszip.min.js', 'text/javascript; charset=utf-8']],
  ['/vendor/LICENSE.markdown', ['vendor/LICENSE.markdown', 'text/plain; charset=utf-8']]
])
const port = Number(process.env.PORT || 8080)
const host = process.env.HOST || '127.0.0.1'

createServer((request, response) => {
  const asset = assets.get(request.url.split('?')[0])
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end()
    return
  }
  if (!asset) {
    response.writeHead(404).end()
    return
  }
  const [path, type] = asset
  const file = createReadStream(new URL(`./public/${path}`, import.meta.url))
  file.on('error', () => response.writeHead(500).end())
  file.on('open', () => {
    response.writeHead(200, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' })
    if (request.method === 'HEAD') {
      file.destroy()
      response.end()
    } else {
      file.pipe(response)
    }
  })
}).listen(port, host, () => console.log(`http://${host}:${port}`))
