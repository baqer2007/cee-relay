const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());

// المفتاح الخاص بك من ScraperAPI
const SCRAPER_API_KEY = '0860e46379a7cd8f860dbf5a5bb8b981';

app.get('/api/get-stream', async (req, res) => {
  let id = req.query.id;
  if (!id && req.query.url) {
    const match = req.query.url.match(/(\d{6,8})/);
    if (match) id = match[1];
  }
  if (!id) return res.status(400).json({ status: 'error', message: 'معرف مطلوب' });

  const targetApi = `https://cee.buzz/api/android/transcoddedFiles/id/${id}`;

  // طلب مباشر عبر ScraperAPI بدون تحديد country_code
  const scraperUrl = `http://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&url=${encodeURIComponent(targetApi)}`;

  try {
    const response = await axios.get(scraperUrl, {
      headers: {
        'Accept': 'application/json'
      },
      timeout: 30000
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
      message: `فشل عبر ScraperAPI: ${errorDetails}`
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
