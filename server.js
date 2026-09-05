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

// 1. مسار فحص البروكسي
app.get('/check-ip', async (req, res) => {
  const agent = getAgent();
  try {
    const config = agent ? { httpAgent: agent, httpsAgent: agent, timeout: 10000 } : { timeout: 10000 };
    const response = await axios.get('http://ip-api.com/json', config);
    res.json({
      status: 'success',
      proxy_used: agent ? `socks5://${process.env.PROXY_HOST}:${process.env.PROXY_PORT}` : 'none',
      detected_country: response.data.countryCode,
      detected_city: response.data.city,
      detected_ip: response.data.query,
      isp: response.data.isp
    });
  } catch (err) {
    res.status(500).json({ status: 'failed', error: err.message });
  }
});

// دالة مساعدة للبحث التلقائي عن أي رابط فيديو داخل كائن البيانات
function extractVideoUrl(obj) {
  if (!obj) return null;
  if (typeof obj === 'string') {
    if (obj.startsWith('http') && (obj.includes('.mp4') || obj.includes('Signature=') || obj.includes('/vascin'))) {
      return obj;
    }
    return null;
  }
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = extractVideoUrl(item);
      if (found) return found;
    }
  } else if (typeof obj === 'object') {
    // إعطاء أولوية للجودات العالية إذا كانت مصفوفة فيديوهات
    if (Array.isArray(obj.videos)) {
      const best = obj.videos.find(v => v.resolution === '720p') ||
                   obj.videos.find(v => v.resolution === '1080p') ||
                   obj.videos[0];
      if (best) {
        const url = best.videourl || best.videoUrl || best.url;
        if (url) return url;
      }
    }
    for (const key of Object.keys(obj)) {
      const found = extractVideoUrl(obj[key]);
      if (found) return found;
    }
  }
  return null;
}

// 2. دالة طلب الـ API من CEE
async function fetchFromCee(videoId, agent) {
  // تجربة الطلب بالمعرف مع ترويسات CEE الكاملة
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': `https://cee.buzz/video/en/${videoId}`,
    'Origin': 'https://cee.buzz',
    'Accept': '*/*'
  };

  // محاولة عبر الرابط المباشر
  const url1 = `https://cee.buzz/video/api/${videoId}?page-url=https://cinemana.shabakaty.com/video/en/${videoId}`;
  
  try {
    const res = await axios.get(url1, { headers, httpAgent: agent, httpsAgent: agent, timeout: 15000 });
    return res.data;
  } catch (e) {
    // محاولة بديلة بدون page-url
    const url2 = `https://cee.buzz/video/api/${videoId}`;
    const res2 = await axios.get(url2, { headers, httpAgent: agent, httpsAgent: agent, timeout: 15000 });
    return res2.data;
  }
}

// 3. مسار تشخيصي لرؤية استجابة CEE الخام
app.get('/debug', async (req, res) => {
  const videoId = req.query.id || '58386727';
  const agent = getAgent();
  try {
    const data = await fetchFromCee(videoId, agent);
    res.json({ status: 'ok', raw_response: data, detected_url: extractVideoUrl(data) });
  } catch (e) {
    res.status(500).json({ error: e.message, response: e.response ? e.response.data : null });
  }
});

// 4. المسار التلقائي للبث: /play
app.get('/play', async (req, res) => {
  let videoId = req.query.id;
  const pageUrl = req.query.url;

  if (!videoId && pageUrl) {
    const match = pageUrl.match(/(\d{6,})/);
    if (match) videoId = match[1];
  }

  if (!videoId) {
    return res.status(400).send('الرجاء إرسال id الفيديو');
  }

  const agent = getAgent();

  try {
    const data = await fetchFromCee(videoId, agent);
    const directVideoUrl = extractVideoUrl(data);

    if (!directVideoUrl) {
      return res.status(404).json({
        status: 'error',
        message: 'تم استلام رد من CEE لكن لم يتم العثور على رابط فيديو بداخله',
        cee_data: data
      });
    }

    const streamHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Referer': 'https://cee.buzz/',
      'Origin': 'https://cee.buzz'
    };

    if (req.headers.range) {
      streamHeaders['Range'] = req.headers.range;
    }

    const videoStream = await axios({
      method: 'get',
      url: directVideoUrl,
      responseType: 'stream',
      headers: streamHeaders,
      httpAgent: agent,
      httpsAgent: agent,
      timeout: 30000,
      validateStatus: (status) => status >= 200 && status < 400
    });

    if (videoStream.headers['content-range']) res.setHeader('Content-Range', videoStream.headers['content-range']);
    if (videoStream.headers['content-length']) res.setHeader('Content-Length', videoStream.headers['content-length']);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', videoStream.headers['content-type'] || 'video/mp4');
    res.status(videoStream.status);

    videoStream.data.pipe(res);

    videoStream.data.on('error', () => {
      if (!res.headersSent) res.status(500).end();
    });

  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({
        status: 'error',
        message: 'تعذر الاتصال بـ CEE',
        details: err.message
      });
    }
  }
});

// المسار اليدوي الاحتياطي
app.get('/stream', async (req, res) => {
  const rawQuery = req.originalUrl.split('/stream?url=')[1];
  const targetUrl = rawQuery ? decodeURIComponent(rawQuery) : req.query.url;
  if (!targetUrl) return res.status(400).send('رابط غير صالح');

  const agent = getAgent();
  try {
    const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Referer': 'https://cee.buzz/' };
    if (req.headers.range) headers['Range'] = req.headers.range;

    const stream = await axios({
      method: 'get',
      url: targetUrl,
      responseType: 'stream',
      headers: headers,
      httpAgent: agent,
      httpsAgent: agent,
      timeout: 30000,
      validateStatus: (s) => s >= 200 && s < 400
    });

    if (stream.headers['content-range']) res.setHeader('Content-Range', stream.headers['content-range']);
    if (stream.headers['content-length']) res.setHeader('Content-Length', stream.headers['content-length']);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', stream.headers['content-type'] || 'video/mp4');
    res.status(stream.status);

    stream.data.pipe(res);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
