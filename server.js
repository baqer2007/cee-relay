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

async function axiosWithRetry(config, retries = 2, delay = 500) {
  for (let i = 0; i < retries; i++) {
    try {
      return await axios(config);
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(res => setTimeout(res, delay));
    }
  }
}

async function fetchMediaDirectly(videoId, agent) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    'Referer': 'https://cee.buzz/',
    'Origin': 'https://cee.buzz',
    'Accept': 'application/json, text/plain, */*'
  };

  const filesApi = `https://cee.buzz/api/android/transcoddedFiles/id/${videoId}`;
  
  const filesRes = await axiosWithRetry({
    url: filesApi,
    method: 'get',
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

  const qualities = list.map(item => ({
    resolution: item.resolution || 'Auto',
    url: item.videoUrl || item.videourl || item.url
  })).filter(item => Boolean(item.url));

  return {
    qualities,
    defaultUrl: (qualities.find(q => q.resolution === '720p') || qualities[0]).url
  };
}

app.get('/check-ip', async (req, res) => {
  const agent = getAgent();
  try {
    const config = agent ? { url: 'http://ip-api.com/json', method: 'get', httpAgent: agent, httpsAgent: agent, timeout: 10000 } : { url: 'http://ip-api.com/json', method: 'get', timeout: 10000 };
    const response = await axiosWithRetry(config);
    res.json({
      status: 'success',
      proxy_used: agent ? `socks5://${process.env.PROXY_HOST}:${process.env.PROXY_PORT}` : 'none',
      detected_country: response.data.countryCode,
      detected_ip: response.data.query
    });
  } catch (err) {
    res.status(500).json({ status: 'failed', error: err.message });
  }
});

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
    const media = await fetchMediaDirectly(id, agent);
    
    res.json({
      status: 'success',
      video_id: id,
      video_url: media.defaultUrl,
      qualities: media.qualities.map(q => ({
        resolution: q.resolution,
        url: q.url
      })),
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
