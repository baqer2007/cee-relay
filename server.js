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
      timeout: 60000
    });
  }
  return null;
}

// دالة جلب رابط الفيديو من واجهة CEE عبر البروكسي
async function fetchDirectVideoUrl(videoId, agent) {
  const apiUrl = `https://cee.buzz/api/android/transcoddedFiles/id/${videoId}`;

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    'Referer': `https://cee.buzz/video/en/${videoId}?show=true`,
    'Origin': 'https://cee.buzz'
  };

  const response = await axios.get(apiUrl, {
    headers: headers,
    httpAgent: agent,
    httpsAgent: agent,
    timeout: 15000
  });

  let data = response.data;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch (e) {}
  }

  let list = Array.isArray(data) ? data : (data && data.videos ? data.videos : []);
  if (list.length > 0) {
    const selected = list.find(v => v.resolution === '720p') ||
                     list.find(v => v.resolution === '1080p') ||
                     list.find(v => v.resolution === '480p') ||
                     list[0];

    return selected.videoUrl || selected.videourl || selected.url;
  }
  throw new Error('لم يتم العثور على رابط فيديو في الاستجابة.');
}

// مسار المشاهدة المباشر للبث
app.get('/play', async (req, res) => {
  let videoId = req.query.id;
  const pageUrl = req.query.url;

  if (!videoId && pageUrl) {
    const match = pageUrl.match(/(\d{6,8})/);
    if (match) videoId = match[1];
  }

  if (!videoId) return res.status(400).send('معرف الفيديو مطلوب');

  const agent = getAgent();

  try {
    // 1. استخراج الرابط الحقيقي
    const targetVideoUrl = await fetchDirectVideoUrl(videoId, agent);

    // 2. إعداد ترويسات المشغل والتأكد من دعم التقديم والترجيع
    const cdnHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Referer': 'https://cee.buzz/',
      'Origin': 'https://cee.buzz'
    };

    if (req.headers.range) {
      cdnHeaders['Range'] = req.headers.range;
    }

    const response = await axios({
      method: 'get',
      url: targetVideoUrl,
      responseType: 'stream',
      headers: cdnHeaders,
      httpAgent: agent,
      httpsAgent: agent,
      timeout: 30000,
      validateStatus: (s) => s >= 200 && s < 400
    });

    // تمرير ترويسات الفيديو وإلغاء أمر التنزيل التلقائي
    if (response.headers['content-range']) {
      res.setHeader('Content-Range', response.headers['content-range']);
    }
    if (response.headers['content-length']) {
      res.setHeader('Content-Length', response.headers['content-length']);
    }

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', 'video/mp4');
    // إجبار المتصفح وVLC على التشغيل بدلاً من التنزيل
    res.setHeader('Content-Disposition', 'inline; filename="video.mp4"');
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

app.listen(PORT, () => console.log(`Running on ${PORT}`));
