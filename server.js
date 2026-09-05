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

// دالة جلب رابط الفيديو المباشر عبر البروكسي العراقي
async function fetchDirectVideoUrl(videoId, agent) {
  const apiUrl = `https://cee.buzz/api/android/transcoddedFiles/id/${videoId}`;

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': `https://cee.buzz/video/en/${videoId}?show=true`,
    'Origin': 'https://cee.buzz',
    'Accept': 'application/json, text/plain, */*'
  };

  const response = await axios.get(apiUrl, {
    headers: headers,
    httpAgent: agent,
    httpsAgent: agent,
    timeout: 15000
  });

  let data = response.data;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch (e) {}
  }

  let videosList = Array.isArray(data) ? data : (data && data.videos ? data.videos : []);

  if (videosList.length > 0) {
    const selected = videosList.find(v => v.resolution === '720p') ||
                     videosList.find(v => v.resolution === '1080p') ||
                     videosList.find(v => v.resolution === '480p') ||
                     videosList[0];

    return selected.videoUrl || selected.videourl || selected.url;
  }

  throw new Error('لم يتم العثور على رابط فيديو صالح داخل الرد.');
}

// مسار المشاهدة السريع والتلقائي
app.get('/play', async (req, res) => {
  let videoId = req.query.id;
  const pageUrl = req.query.url;

  if (!videoId && pageUrl) {
    const match = pageUrl.match(/(\d{6,8})/);
    if (match) videoId = match[1];
  }

  if (!videoId) {
    return res.status(400).send('الرجاء إرسال id الفيديو');
  }

  const agent = getAgent();

  try {
    const directUrl = await fetchDirectVideoUrl(videoId, agent);
    
    // توجيه المتصفح أو مشغل الفيديو مباشرة للرابط الموقع
    res.redirect(302, directUrl);

  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: 'تعذر استخراج رابط الفيديو من CEE',
      details: err.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
