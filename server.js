const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());

app.get('/api/get-stream', async (req, res) => {
  let id = req.query.id;
  if (!id && req.query.url) {
    const match = req.query.url.match(/(\d{6,8})/);
    if (match) id = match[1];
  }
  if (!id) return res.status(400).json({ status: 'error', message: 'معرف مطلوب' });

  const targetApi = `https://cee.buzz/api/android/transcoddedFiles/id/${id}`;

  // مسار جلب الصفحة عبر مترجم جوجل
  const googleTranslateUrl = `https://translate.google.com/translate?sl=auto&tl=en&u=${encodeURIComponent(targetApi)}`;

  try {
    const response = await axios.get(googleTranslateUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      },
      timeout: 15000
    });

    const htmlContent = response.data;

    // استخراج محتوى الـ JSON من الصفحة المرجعة
    let jsonMatch = htmlContent.match(/\[\s*\{.*"videoUrl".*\}\s*\]/s) ||
                     htmlContent.match(/\{.*"videos".*?\}/s);

    let filesData = null;

    if (jsonMatch) {
      try {
        filesData = JSON.parse(jsonMatch[0]);
      } catch (e) {}
    }

    // إذا تم إرجاع الرد مباشرة كنص أو كائن
    if (!filesData && typeof htmlContent === 'object') {
      filesData = htmlContent;
    }

    if (!filesData) {
      return res.status(502).json({
        status: 'error',
        message: 'تعذر استخراج بيانات الفيديو من استجابة المترجم'
      });
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
      message: `فشل عبر Google Translate: ${errorDetails}`
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
