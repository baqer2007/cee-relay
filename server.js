const express = require('express');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent'); // مخصص لبروكسيات HTTP/HTTPS السريعة

const app = express();
const PORT = process.env.PORT || 10000;

// أقوى وأسرع البروكسيات المستخرجة من الملف المرفق
const proxyList = [
  'http://109.224.22.36:51372',
  'http://185.122.252.42:8080',
  'http://212.126.96.154:8080',
  'http://5.8.240.93:4153',
  'http://176.241.94.228:10801',
  'http://62.201.223.174:8186',
  'http://5.1.104.67:33041'
];

let currentProxyIndex = 0;

// دالة لجلب البروكسي الحالي
function getCurrentAgent() {
  if (proxyList.length === 0) return null;
  const proxyUrl = proxyList[currentProxyIndex];
  return new HttpsProxyAgent(proxyUrl);
}

// دالة لتغيير البروكسي إلى التالي في حال فشل الحالي
function rotateProxy() {
  currentProxyIndex = (currentProxyIndex + 1) % proxyList.length;
  console.log(`[Proxy Rotate] تم الانتقال إلى البروكسي رقم ${currentProxyIndex}: ${proxyList[currentProxyIndex]}`);
}

app.get('/api/get-stream', async (req, res) => {
  let id = req.query.id;
  if (!id && req.query.url) {
    const match = req.query.url.match(/(\d{6,8})/);
    if (match) id = match[1];
  }
  if (!id) return res.status(400).json({ status: 'error', message: 'معرف مطلوب' });

  const filesApi = `https://cee.buzz/api/android/transcoddedFiles/id/${id}`;

  // محاولة الاتصال مع تدوير البروكسيات تلقائياً في حال فشل أو انقضاء المهلة
  let attempts = 0;
  let success = false;
  let response;

  while (attempts < proxyList.length && !success) {
    const agent = getCurrentAgent();
    try {
      response = await axios.get(filesApi, {
        headers: { 
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 
          'Referer': 'https://cee.buzz/' 
        },
        httpAgent: agent, 
        httpsAgent: agent, 
        timeout: 6000 // مهلة 6 ثوانٍ لكل محاولة لتكون سريعة
      });
      if (response.status === 200) {
        success = true;
      }
    } catch (err) {
      attempts++;
      rotateProxy(); // تجربة البروكسي التالي
    }
  }

  if (!success) {
    return res.status(500).json({ status: 'error', message: 'تعذر الاتصال عبر جميع البروكسيات المتاحة.' });
  }

  try {
    let filesData = response.data;
    if (typeof filesData === 'string') {
      try { filesData = JSON.parse(filesData); } catch(e){}
    }
    
    const list = Array.isArray(filesData) ? filesData : (filesData.videos || []);
    if (!list.length) return res.status(404).json({ status: 'error', message: 'لا توجد ملفات فيديو' });

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
    res.status(500).json({ status: 'error', message: `خطأ في المعالجة: ${err.message}` });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
