const express = require('express');
const axios = require('axios');
const { SocksProxyAgent } = require('socks-proxy-agent');

const app = express();
const PORT = process.env.PORT || 10000;

function getAgent() {
  const host = process.env.PROXY_HOST;
  const port = process.env.PROXY_PORT;
  if (host && port) {
    const cleanHost = host.replace(/^https?:\/\//, '').replace(/\/$/, '');
    // استخدام صيغة IP مباشرة أو رابط النفق مع المنفذ بشكل صريح
    return new SocksProxyAgent(`socks5://${cleanHost}:${port}`);
  }
  return null;
}

app.get('/api/get-stream', async (req, res) => {
  let id = req.query.id;
  const pageUrl = req.query.url;

  if (!id && pageUrl) {
    const match = pageUrl.match(/(\d{6,8})/);
    if (match) id = match[1];
  }

  if (!id) {
    return res.status(400).json({ status: 'error', message: 'معرف الفيديو مطلوب' });
  }

  const agent = getAgent();

  try {
    const filesApi = `https://cee.buzz/api/android/transcoddedFiles/id/${id}`;
    
    // رفع المهلة إلى 30 ثانية لضمان عبور الطلب عبر نفق Termux البطيء
    const response = await axios.get(filesApi, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer': 'https://cee.buzz/',
        'Origin': 'https://cee.buzz',
        'Accept': 'application/json, text/plain, */*'
      },
      httpAgent: agent,
      httpsAgent: agent,
      timeout: 30000
    });

    let filesData = response.data;
    if (typeof filesData === 'string') {
      try { filesData = JSON.parse(filesData); } catch (e) {}
    }

    const list = Array.isArray(filesData) ? filesData : (filesData && filesData.videos ? filesData.videos : []);
    if (!list.length) {
      throw new Error('لم يتم العثور على ملفات فيديو.');
    }

    const qualities = list.map(item => ({
      resolution: item.resolution || 'Auto',
      url: item.videoUrl || item.videourl || item.url
    })).filter(item => Boolean(item.url));

    const defaultUrl = (qualities.find(q => q.resolution === '720p') || qualities[0]).url;

    res.json({
      status: 'success',
      video_id: id,
      video_url: defaultUrl,
      qualities: qualities,
      subtitles: []
    });

  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
