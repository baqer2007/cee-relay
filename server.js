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

// دالة مساعدة للبحث داخل كائنات الردود
function findKeyDeep(obj, keyName) {
  if (!obj) return null;
  if (obj[keyName]) return obj[keyName];
  if (typeof obj === 'object') {
    for (const k of Object.keys(obj)) {
      const res = findKeyDeep(obj[k], keyName);
      if (res) return res;
    }
  }
  return null;
}

// دالة الاستخراج التلقائي الكامل بمرحلتين
async function resolveAndFetchVideo(inputParam, agent) {
  const defaultHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    'Referer': 'https://cee.buzz/',
    'Origin': 'https://cee.buzz',
    'Accept': 'application/json, text/plain, */*'
  };

  let targetVideoId = inputParam;

  // المرحلة 1: إذا كان الرقم هو رقم صفحة CEE، نسحب تفاصيل العمل لمعرفة معرف الفيديو الداخلي
  try {
    const postInfoUrl = `https://cee.buzz/api/android/video/id/${inputParam}`;
    const postRes = await axios.get(postInfoUrl, {
      headers: defaultHeaders,
      httpAgent: agent,
      httpsAgent: agent,
      timeout: 10000
    });

    const data = postRes.data;
    // استخراج معرف الفيديو من تفاصيل المنشور إذا وجد
    const internalId = (data && data.videos && data.videos[0] && data.videos[0].id) ||
                       (data && data.episodes && data.episodes[0] && data.episodes[0].id) ||
                       findKeyDeep(data, 'video_id') ||
                       findKeyDeep(data, 'videoId');

    if (internalId) {
      targetVideoId = internalId;
    }
  } catch (e) {
    // في حال كان الرقم المدخل هو أصلاً معرف الفيديو الداخلي، نستمر مباشرة
  }

  // المرحلة 2: طلب روابط الفيديو الموقعة باستخدام المعرف المحسوب
  const filesApi = `https://cee.buzz/api/android/transcoddedFiles/id/${targetVideoId}`;
  const filesRes = await axios.get(filesApi, {
    headers: defaultHeaders,
    httpAgent: agent,
    httpsAgent: agent,
    timeout: 15000
  });

  let filesData = filesRes.data;
  if (typeof filesData === 'string') {
    try { filesData = JSON.parse(filesData); } catch (e) {}
  }

  const list = Array.isArray(filesData) ? filesData : (filesData && filesData.videos ? filesData.videos : []);
  if (list.length > 0) {
    const selected = list.find(v => v.resolution === '720p') ||
                     list.find(v => v.resolution === '480p') ||
                     list.find(v => v.resolution === '1080p') ||
                     list[0];

    const finalUrl = selected.videoUrl || selected.videourl || selected.url;
    if (finalUrl) return finalUrl;
  }

  throw new Error(`تعذر استخراج ملفات الفيديو للمعرف: ${targetVideoId}`);
}

// مسار التشغيل التلقائي
app.get('/play', async (req, res) => {
  let id = req.query.id;
  const pageUrl = req.query.url;

  if (!id && pageUrl) {
    const match = pageUrl.match(/(\d{6,8})/);
    if (match) id = match[1];
  }

  if (!id) return res.status(400).send('يرجى تزويد id أو url');

  const agent = getAgent();

  try {
    const directUrl = await resolveAndFetchVideo(id, agent);
    const vlcIntent = `intent:${directUrl}#Intent;package=org.videolan.vlc;type=video/*;end`;

    res.send(`
      <!DOCTYPE html>
      <html lang="ar" dir="rtl">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>مشغل CEE التلقائي</title>
        <style>
          body { margin: 0; padding: 20px; background: #0b0f19; color: white; font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 90vh; }
          .card { width: 100%; max-width: 500px; background: #1e293b; padding: 25px; border-radius: 16px; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
          .btn-vlc { display: block; background: #f97316; color: white; text-decoration: none; padding: 16px; border-radius: 12px; font-weight: bold; font-size: 1.15rem; margin: 20px 0; }
          video { width: 100%; border-radius: 10px; margin-top: 15px; background: #000; }
        </style>
      </head>
      <body>
        <div class="card">
          <h3>جاهز للمشاهدة 🍿</h3>
          <a href="${vlcIntent}" class="btn-vlc">فتح في تطبيق VLC تلقائياً 🚀</a>
          
          <video controls playsinline preload="metadata">
            <source src="${directUrl}" type="video/mp4">
          </video>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send(`
      <div style="direction:rtl;font-family:sans-serif;padding:20px;color:#ef4444;">
        <h4>فشل الاستخراج التلقائي:</h4>
        <p>${err.message}</p>
      </div>
    `);
  }
});

app.listen(PORT, () => console.log(`Running on ${PORT}`));
