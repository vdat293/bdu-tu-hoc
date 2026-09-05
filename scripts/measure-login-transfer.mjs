import { load } from 'cheerio';

const port = Number(process.env.BDU_PORT || process.argv[2] || 3000);
const origin = `http://127.0.0.1:${port}`;
const response = await fetch(`${origin}/`, { headers: { 'Accept-Encoding': 'br' } });
if (!response.ok) throw new Error(`GET / failed: ${response.status}`);
const html = await response.text();
const $ = load(html);
$('template').remove();
const urls = new Set(['/']);
$('link[href],script[src],img[src],source[srcset]').each((_, element) => {
  if (element.tagName === 'img' && $(element).parent('picture').find('source[srcset]').length) return;
  const value = $(element).attr('href') || $(element).attr('src') || $(element).attr('srcset')?.split(',')[0]?.trim().split(/\s+/)[0];
  if (!value || value.startsWith('data:') || value.startsWith('http://') || value.startsWith('https://')) return;
  urls.add(new URL(value, origin).pathname + (new URL(value, origin).search || ''));
});

const resources = [];
for (const resource of urls) {
  const item = await fetch(`${origin}${resource}`, { headers: { 'Accept-Encoding': 'br' } });
  const body = new Uint8Array(await item.arrayBuffer());
  const wireBytes = Number(item.headers.get('content-length') || body.byteLength);
  resources.push({
    resource,
    status: item.status,
    contentEncoding: item.headers.get('content-encoding') || '',
    cacheControl: item.headers.get('cache-control') || '',
    encodedBytes: wireBytes,
    decodedBytes: body.byteLength
  });
}

const totalBytes = resources.reduce((sum, item) => sum + (item.status === 200 ? item.encodedBytes : 0), 0);
console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  origin,
  resourceCount: resources.length,
  totalEncodedBytes: totalBytes,
  resources
}, null, 2));
