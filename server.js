const express = require('express');
const axios = require('axios');
const { SocksProxyAgent } = require('socks-proxy-agent');

const app = express();
const PORT = process.env.PORT || 10000;

// إعداد وكيل SOCKS5 الموجه عبر نفق الهاتف
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

// 1. مسار فحص الاتصال بالـ IP العراقي
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
    res.status(500).json({
      status: 'failed',
      error: `تعذر الاتصال بالبروكسي: ${err.message}`,
      proxy: agent ? `socks5://${process.env.PROXY_HOST}:${process.env.PROXY_PORT}` : 'none'
    });
  }
});

// 2. دالة جلب رابط الفيديو من واجهة برمجة تطبيقات cee.buzz تلقائياً
async function fetchDirectVideoUrl(videoId, agent) {
  const apiUrl = `https://cee.buzz/video/api/${videoId}`;

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': `https://cee.buzz/video/en/${videoId}`,
    'Origin': 'https://cee.buzz',
    'Accept': 'application/json, text/plain, */*'
  };

  const response = await axios.get(apiUrl, {
    headers: headers,
    httpAgent: agent,
    httpsAgent: agent,
    timeout: 20000
  });

  const data = response.data;
  let videosList = [];

  if (Array.isArray(data)) {
    videosList = data;
  } else if (data && Array.isArray(data.videos)) {
    videosList = data.videos;
  }

  if (videosList.length > 0) {
    // اختيار دقة مناسبة للبث السلس (720p أو 1080p أو أول جودة متوفرة)
    const selected = videosList.find(v => v.resolution === '720p') ||
                     videosList.find(v => v.resolution === '1080p') ||
                     videosList[0];

    const target = selected.videoUrl || selected.url;
    if (target) return target;
  }

  throw new Error('لم يتم العثور على روابط فيديو داخل استجابة CEE.');
}

// 3. المسار التلقائي الرئيسي: /play
app.get('/play', async (req, res) => {
  let videoId = req.query.id;
  const pageUrl = req.query.url;

  // استخراج الـ id إذا أُرسل رابط صفحة cee بالكامل
  if (!videoId && pageUrl) {
    const match = pageUrl.match(/(\d{6,})/);
    if (match) {
      videoId = match[1];
    }
  }

  if (!videoId) {
    return res.status(400).send('الرجاء إرسال id الفيديو أو رابط صفحة المشاهدة url.');
  }

  const agent = getAgent();

  try {
    // خطوة أ: سحب رابط الفيديو المباشر والتوقيع الفوري من CEE
    const directVideoUrl = await fetchDirectVideoUrl(videoId, agent);

    // خطوة ب: تمرير تدفق الفيديو إلى المتصفح / المشغل
    const streamHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
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

    videoStream.data.on('error', (err) => {
      console.error('انقطاع أثناء تدفق الفيديو:', err.message);
      if (!res.headersSent) res.status(500).end();
    });

  } catch (err) {
    console.error('فشل الجلب التلقائي من CEE:', err.message);
    if (!res.headersSent) {
      res.status(500).json({
        status: 'error',
        message: 'تعذر سحب الفيديو تلقائياً من CEE',
        details: err.message
      });
    }
  }
});

// 4. المسار المباشر الاحتياطي
app.get('/stream', async (req, res) => {
  const rawQuery = req.originalUrl.split('/stream?url=')[1];
  const targetUrl = rawQuery ? decodeURIComponent(rawQuery) : req.query.url;

  if (!targetUrl) return res.status(400).send('رابط غير صالح');

  const agent = getAgent();
  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://cee.buzz/',
      'Origin': 'https://cee.buzz'
    };

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
