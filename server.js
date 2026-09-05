const express = require('express');
const axios = require('axios');
const { SocksProxyAgent } = require('socks-proxy-agent');

const app = express();
const PORT = process.env.PORT || 10000;

function getAgent() {
  try {
    const host = process.env.PROXY_HOST;
    const port = process.env.PROXY_PORT;
    if (host && port) {
      const cleanHost = host.replace(/^https?:\/\//, '').replace(/\/$/, '');
      return new SocksProxyAgent(`socks5://${cleanHost}:${port}`);
    }
  } catch (e) {}
  return null;
}

// 1. مسار جلب تفاصيل الفيديو والجودات وتغليفها برابط سيرفرنا الخاص
app.get('/api/get-stream', async (req, res) => {
  let id = req.query.id;
  if (!id && req.query.url) {
    const match = req.query.url.match(/(\d{6,8})/);
    if (match) id = match[1];
  }
  if (!id) return res.status(400).json({ status: 'error', message: 'معرف مطلوب' });

  try {
    const agent = getAgent();
    const filesApi = `https://cee.buzz/api/android/transcoddedFiles/id/${id}`;
    const response = await axios.get(filesApi, {
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 
        'Referer': 'https://cee.buzz/' 
      },
      httpAgent: agent, 
      httpsAgent: agent, 
      timeout: 25000
    });

    let filesData = response.data;
    if (typeof filesData === 'string') {
      try { filesData = JSON.parse(filesData); } catch(e){}
    }
    
    const list = Array.isArray(filesData) ? filesData : (filesData.videos || []);
    if (!list.length) return res.status(404).json({ status: 'error', message: 'لا توجد ملفات فيديو' });

    const qualities = list.map(item => {
      const rawUrl = item.videoUrl || item.videourl || item.url;
      return {
        resolution: item.resolution || 'Auto',
        // تحويل الرابط الأصلي ليصبح ماراً عبر سيرفرنا كـ Proxy Stream
        url: `${req.protocol}://${req.get('host')}/api/stream-proxy?url=${encodeURIComponent(rawUrl)}`
      };
    }).filter(q => q.url);

    res.json({
      status: 'success',
      video_url: qualities.find(q => q.resolution === '720p')?.url || qualities[0].url,
      qualities: qualities,
      subtitles: []
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// 2. مسار البث الوسيط (Stream Proxy) لسحب وتمرير الفيديو بسلاسة للمشغل
app.get('/api/stream-proxy', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('URL required');

  try {
    const agent = getAgent();
    const response = await axios.get(targetUrl, {
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer': 'https://cee.buzz/',
        'Range': req.headers.range || 'bytes=0-'
      },
      httpAgent: agent,
      httpsAgent: agent,
      timeout: 30000
    });

    res.writeHead(response.status, response.headers);
    response.data.pipe(res);
  } catch (err) {
    res.status(500).send(`Proxy Error: ${err.message}`);
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
