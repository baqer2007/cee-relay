const express = require('express');
const axios = require('axios');
const { SocksProxyAgent } = require('socks-proxy-agent');

const app = express();
const PORT = process.env.PORT || 10000;

function getAgent() {
  const host = process.env.PROXY_HOST;
  const port = process.env.PROXY_PORT;
  if (host && port) {
    return new SocksProxyAgent(`socks5://${host}:${port}`, {
      keepAlive: true,
      timeout: 120000
    });
  }
  return null;
}

// 1. جلب رابط الفيديو من API الخاص بالمنصة
async function fetchDirectVideoUrl(videoId, agent) {
  const apiUrl = `https://cee.buzz/api/android/transcoddedFiles/id/${videoId}`;
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    'Referer': `https://cee.buzz/video/en/${videoId}?show=true`,
    'Origin': 'https://cee.buzz',
    'Accept': 'application/json, text/plain, */*'
  };

  const response = await axios.get(apiUrl, {
    headers,
    httpAgent: agent,
    httpsAgent: agent,
    timeout: 15000
  });

  let data = response.data;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch (e) {}
  }

  const list = Array.isArray(data) ? data : (data && data.videos ? data.videos : []);
  if (list.length > 0) {
    const selected = list.find(v => v.resolution === '480p') ||
                     list.find(v => v.resolution === '720p') ||
                     list.find(v => v.resolution === '360p') ||
                     list[0];

    return selected.videoUrl || selected.videourl || selected.url;
  }
  throw new Error('لم يتم العثور على رابط فيديو في الاستجابة.');
}

// 2. مسار جلب البث الحقيقي وتمرير الترويسات الصحيحة
app.get('/stream-video', async (req, res) => {
  const videoId = req.query.id;
  if (!videoId) return res.status(400).send('معرف الفيديو مطلوب');

  const agent = getAgent();

  try {
    const directUrl = await fetchDirectVideoUrl(videoId, agent);

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Referer': 'https://cee.buzz/',
      'Origin': 'https://cee.buzz'
    };

    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    const response = await axios({
      method: 'get',
      url: directUrl,
      responseType: 'stream',
      headers,
      httpAgent: agent,
      httpsAgent: agent,
      timeout: 0,
      validateStatus: (status) => status >= 200 && status < 400
    });

    if (response.headers['content-range']) {
      res.setHeader('Content-Range', response.headers['content-range']);
    }
    if (response.headers['content-length']) {
      res.setHeader('Content-Length', response.headers['content-length']);
    }

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', 'inline');
    res.status(response.status);

    response.data.pipe(res);

    response.data.on('error', () => {
      if (!res.headersSent) res.status(500).end();
    });

  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'تعذر تشغيل الفيديو', details: err.message });
    }
  }
});

// 3. صفحة المشاهدة المباشرة التي تطلب من مسار /stream-video الخاص بالسيرفر
app.get('/play', (req, res) => {
  const videoId = req.query.id || '3130508';

  res.send(`
    <!DOCTYPE html>
    <html lang="ar">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>مشاهدة الفيديو</title>
      <style>
        body, html { margin: 0; padding: 0; width: 100%; height: 100%; background: #000; display: flex; justify-content: center; align-items: center; }
        video { width: 100%; height: 100%; max-height: 100vh; }
      </style>
    </head>
    <body>
      <video controls autoplay playsinline>
        <source src="/stream-video?id=${videoId}" type="video/mp4">
        متصفحك لا يدعم تشغيل هذا الفيديو.
      </video>
    </body>
    </html>
  `);
});

app.listen(PORT, () => console.log(`Running on ${PORT}`));
