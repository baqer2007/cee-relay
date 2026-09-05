const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());

// عنوان IP عراقي حقيقي تابع لمزود خدمة محلي
const SPOOFED_IRAQI_IP = '37.236.143.15';

app.get('/api/get-stream', async (req, res) => {
  let id = req.query.id;
  if (!id && req.query.url) {
    const match = req.query.url.match(/(\d{6,8})/);
    if (match) id = match[1];
  }
  if (!id) return res.status(400).json({ status: 'error', message: 'معرف مطلوب' });

  const filesApi = `https://cee.buzz/api/android/transcoddedFiles/id/${id}`;

  try {
    const response = await axios.get(filesApi, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://cee.buzz/',
        'Accept': 'application/json, text/plain, */*',
        // حزمة ترويسات خداع السيرفر والبروكسيات العكسية
        'X-Forwarded-For': SPOOFED_IRAQI_IP,
        'X-Real-IP': SPOOFED_IRAQI_IP,
        'Client-IP': SPOOFED_IRAQI_IP,
        'X-Client-IP': SPOOFED_IRAQI_IP,
        'CF-Connecting-IP': SPOOFED_IRAQI_IP,
        'Fastly-Client-IP': SPOOFED_IRAQI_IP,
        'True-Client-IP': SPOOFED_IRAQI_IP
      },
      timeout: 10000
    });

    let filesData = response.data;
    if (typeof filesData === 'string') {
      try { filesData = JSON.parse(filesData); } catch (e) {}
    }

    const list = Array.isArray(filesData) ? filesData : (filesData.videos || []);
    if (!list.length) return res.status(404).json({ status: 'error', message: 'لا توجد ملفات فيديو متاحة' });

    const qualities = list.map(item => ({
      resolution: item.resolution || 'Auto',
      url: item.videoUrl || item.videourl || item.url
    })).filter(q => q.url);

    const defaultUrl = qualities.find(q => q.resolution === '720p')?.url || qualities[0].url;

    res.json({
      status: 'success',
      video_url: defaultUrl,
      qualities: qualities,
      subtitles: []
    });

  } catch (err) {
    const statusCode = err.response ? err.response.status : 500;
    const errorDetails = err.response ? JSON.stringify(err.response.data) : err.message;
    res.status(statusCode).json({
      status: 'error',
      message: `فشل الاتصال: ${errorDetails}`
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
