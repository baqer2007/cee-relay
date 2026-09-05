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

// دالة سحب الرابط من CEE
async function getCeeVideo(videoId, agent) {
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
                     list.find(v => v.resolution === '480p') ||
                     list[0];
    return selected.videoUrl || selected.videourl || selected.url;
  }
  throw new Error('لم يتم العثور على رابط فيديو في الاستجابة.');
}

// مسار المشاهدة مع مشغل HTML5 كامل
app.get('/play', async (req, res) => {
  let videoId = req.query.id || '3130508';
  const agent = getAgent();

  try {
    const videoUrl = await getCeeVideo(videoId, agent);

    // صفحة عرض مدمجة تتجاوز أمر التحميل التلقائي وتشغل الفيديو فوراً
    res.send(`
      <!DOCTYPE html>
      <html lang="ar" dir="rtl">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>مشغل CEE</title>
        <style>
          body, html { margin: 0; padding: 0; width: 100%; height: 100%; background: #000; display: flex; justify-content: center; align-items: center; }
          video { width: 100%; height: 100%; max-height: 100vh; }
        </style>
      </head>
      <body>
        <video controls autoplay playsinline>
          <source src="${videoUrl}" type="video/mp4">
          متصفحك لا يدعم تشغيل هذا الفيديو.
        </video>
      </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send(`<h3>خطأ في الاتصال بالبروكسي أو السيرفر: ${err.message}</h3><p>تأكد من أن نفق Pinggy في Termux لا يزال نشطاً.</p>`);
  }
});

app.listen(PORT, () => console.log(`Running on ${PORT}`));
