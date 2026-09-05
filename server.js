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

// دالة جلب كافة تفاصيل الفيديو (جودات متعددة + ترجمات)
async function fetchFullMediaDetails(inputParam, agent) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    'Referer': 'https://cee.buzz/',
    'Origin': 'https://cee.buzz',
    'Accept': 'application/json, text/plain, */*'
  };

  let targetVideoId = inputParam;
  let subtitles = [];

  // المرحلة 1: جلب التفاصيل ومعرف الفيديو الداخلي والترجمات
  try {
    const postInfoUrl = `https://cee.buzz/api/android/video/id/${inputParam}`;
    const postRes = await axios.get(postInfoUrl, {
      headers,
      httpAgent: agent,
      httpsAgent: agent,
      timeout: 10000
    });

    const data = postRes.data;
    const internalId = (data && data.videos && data.videos[0] && data.videos[0].id) ||
                       (data && data.episodes && data.episodes[0] && data.episodes[0].id) ||
                       findKeyDeep(data, 'video_id') ||
                       findKeyDeep(data, 'videoId');

    if (internalId) targetVideoId = internalId;

    // استخراج الترجمات إن وجدت
    if (data && data.subtitles && Array.isArray(data.subtitles)) {
      subtitles = data.subtitles.map(s => ({
        lang: s.language || s.name || 'العربية',
        url: s.fileUrl || s.url || s.file
      }));
    }
  } catch (e) {}

  // المرحلة 2: سحب الروابط الموقعة لكافة الجودات
  const filesApi = `https://cee.buzz/api/android/transcoddedFiles/id/${targetVideoId}`;
  const filesRes = await axios.get(filesApi, {
    headers,
    httpAgent: agent,
    httpsAgent: agent,
    timeout: 15000
  });

  let filesData = filesRes.data;
  if (typeof filesData === 'string') {
    try { filesData = JSON.parse(filesData); } catch (e) {}
  }

  const list = Array.isArray(filesData) ? filesData : (filesData && filesData.videos ? filesData.videos : []);
  if (!list.length) {
    throw new Error('لم يتم العثور على ملفات فيديو.');
  }

  // جمع الجودات المتاحة
  const qualities = list.map(item => ({
    resolution: item.resolution || 'Auto',
    url: item.videoUrl || item.videourl || item.url
  })).filter(item => Boolean(item.url));

  return {
    qualities,
    subtitles,
    defaultUrl: (qualities.find(q => q.resolution === '720p') || qualities[0]).url
  };
}

// 1. مسار وسيط لتمرير ملفات الترجمة لتعمل على آسياسيل
app.get('/api/sub-proxy', async (req, res) => {
  const subUrl = req.query.url;
  if (!subUrl) return res.status(400).send('رابط الترجمة مطلوب');

  const agent = getAgent();
  try {
    const response = await axios.get(subUrl, {
      httpAgent: agent,
      httpsAgent: agent,
      responseType: 'text',
      timeout: 10000
    });
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.send(response.data);
  } catch (err) {
    res.status(500).send('فشل تحميل ملف الترجمة');
  }
});

// 2. مسار جلب البث والجودات والترجمة للتطبيق
app.get('/api/get-stream', async (req, res) => {
  let id = req.query.id;
  const pageUrl = req.query.url;

  if (!id && pageUrl) {
    const match = pageUrl.match(/(\d{6,8})/);
    if (match) id = match[1];
  }

  if (!id) return res.status(400).json({ error: 'معرف الفيديو مطلوب' });

  const agent = getAgent();

  try {
    const media = await fetchFullMediaDetails(id, agent);
    
    // إعادة الروابط المجهزة للتطبيق مع توجيه الترجمة عبر السيرفر لتعمل على شبكة آسياسيل
    res.json({
      status: 'success',
      video_url: media.defaultUrl,
      qualities: media.qualities,
      subtitles: media.subtitles.map(s => ({
        lang: s.lang,
        url: `https://${req.get('host')}/api/sub-proxy?url=${encodeURIComponent(s.url)}`
      }))
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.listen(PORT, () => console.log(`Running on ${PORT}`));
