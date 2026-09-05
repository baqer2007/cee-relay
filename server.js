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

// 1. فحص الاتصال بالبروكسي العراقي
app.get('/check-ip', async (req, res) => {
  const agent = getAgent();
  try {
    const config = agent ? { httpAgent: agent, httpsAgent: agent, timeout: 10000 } : { timeout: 10000 };
    const response = await axios.get('http://ip-api.com/json', config);
    res.json({
      status: 'success',
      detected_country: response.data.countryCode,
      detected_city: response.data.city,
      detected_ip: response.data.query,
      isp: response.data.isp
    });
  } catch (err) {
    res.status(500).json({ status: 'failed', error: err.message });
  }
});

// 2. دالة داخلية لجلب رابط الفيديو من المنصة تلقائياً عبر معرف المادة
async function fetchDirectVideoUrl(videoId, agent) {
  // محاولة جلب البيانات من واجهة API سينمانا/CEE
  const apiUrl = `https://cinemana.shabakaty.com/api/android/video/id/${videoId}`;
  
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://cinemana.shabakaty.com/',
    'Origin': 'https://cinemana.shabakaty.com'
  };

  const response = await axios.get(apiUrl, {
    headers: headers,
    httpAgent: agent,
    httpsAgent: agent,
    timeout: 15000
  });

  const data = response.data;
  // استخراج رابط الفيديو المباشر من ملفات الدقة المتاحة
  if (data && data.videos && data.videos.length > 0) {
    // اختيار أعلى جودة أو أول جودة متاحة (مثل 720p أو 1080p)
    const selectedVideo = data.videos.find(v => v.resolution === '720p') || data.videos[0];
    return selectedVideo.videoUrl;
  }

  throw new Error('لم يتم العثور على روابط فيديو داخل استجابة المنصة.');
}

// 3. المسار التلقائي للمشاهدة: /play
app.get('/play', async (req, res) => {
  let videoId = req.query.id;
  const pageUrl = req.query.url;

  // استخراج المعرّف إذا أرسل المستخدم رابط الصفحة كاملاً
  if (!videoId && pageUrl) {
    const match = pageUrl.match(/(?:video\/[a-z]{2}\/|id\/)(\d+)/i) || pageUrl.match(/(\d{6,})/);
    if (match) {
      videoId = match[1];
    }
  }

  if (!videoId) {
    return res.status(400).send('الرجاء إرسال id الفيديو أو رابط الصفحة url.');
  }

  const agent = getAgent();

  try {
    // خطوة أ: جلب الرابط الحقيقي والموقع باللحظة الحالية
    const directUrl = await fetchDirectVideoUrl(videoId, agent);

    // خطوة ب: تمرير تدفق الفيديو إلى المستخدم
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://cinemana.shabakaty.com/'
    };

    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    const videoStream = await axios({
      method: 'get',
      url: directUrl,
      responseType: 'stream',
      headers: headers,
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
      console.error('انقطاع في دفق الفيديو:', err.message);
      if (!res.headersSent) res.status(500).end();
    });

  } catch (err) {
    console.error('فشل الجلب التلقائي:', err.message);
    res.status(500).json({
      status: 'error',
      message: 'تعذر سحب الفيديو تلقائياً',
      error: err.message
    });
  }
});

// المسار اليدوي الاحتياطي
app.get('/stream', async (req, res) => {
  const rawQuery = req.originalUrl.split('/stream?url=')[1];
  const targetUrl = rawQuery || req.query.url;
  if (!targetUrl) return res.status(400).send('رابط غير صالح');

  const agent = getAgent();
  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Referer': 'https://cee.buzz/'
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
