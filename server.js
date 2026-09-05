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
      timeout: 30000
    });
  }
  return null;
}

// دالة جلب رابط الفيديو من واجهة المنصة عبر البروكسي
async function fetchDirectVideoUrl(videoId, agent) {
  const apiUrl = `https://cee.buzz/api/android/transcoddedFiles/id/${videoId}`;
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    'Referer': `https://cee.buzz/video/en/${videoId}?show=true`,
    'Origin': 'https://cee.buzz'
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
    const selected = list.find(v => v.resolution === '720p') ||
                     list.find(v => v.resolution === '1080p') ||
                     list.find(v => v.resolution === '480p') ||
                     list[0];

    return selected.videoUrl || selected.videourl || selected.url;
  }
  throw new Error('لم يتم العثور على رابط فيديو في الاستجابة.');
}

// دالة التعامل مع بث الفيديو لمشغلات الميديا (تدعم GET و HEAD)
async function handleStream(req, res) {
  let videoId = req.query.id;
  const pageUrl = req.query.url;

  if (!videoId && pageUrl) {
    const match = pageUrl.match(/(\d{6,8})/);
    if (match) videoId = match[1];
  }

  if (!videoId) return res.status(400).send('معرف الفيديو مطلوب');

  const agent = getAgent();

  try {
    // 1. جلب الرابط من API عبر البروكسي
    const targetVideoUrl = await fetchDirectVideoUrl(videoId, agent);

    // 2. إعداد الترويسات لجلب الفيديو من سيرفرات CDN
    const cdnHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Referer': 'https://cee.buzz/',
      'Origin': 'https://cee.buzz'
    };

    if (req.headers.range) {
      cdnHeaders['Range'] = req.headers.range;
    }

    // إذا كان الطلب HEAD من VLC للتأكد من الملف فقط
    if (req.method === 'HEAD') {
      const headRes = await axios.head(targetVideoUrl, {
        headers: cdnHeaders,
        timeout: 15000,
        validateStatus: (s) => s >= 200 && s < 400
      });
      res.set(headRes.headers);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Type', 'video/mp4');
      return res.status(headRes.status).end();
    }

    // طلب تدفق الفيديو الفعلي
    const response = await axios({
      method: 'get',
      url: targetVideoUrl,
      responseType: 'stream',
      headers: cdnHeaders,
      timeout: 30000,
      validateStatus: (s) => s >= 200 && s < 400
    });

    if (response.headers['content-range']) {
      res.setHeader('Content-Range', response.headers['content-range']);
    }
    if (response.headers['content-length']) {
      res.setHeader('Content-Length', response.headers['content-length']);
    }

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', response.headers['content-type'] || 'video/mp4');
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
}

// دعم مسار /play لطلبات GET و HEAD الخاصة بمشغلات الوسائط
app.get('/play', handleStream);
app.head('/play', handleStream);

app.listen(PORT, () => console.log(`Running on ${PORT}`));
