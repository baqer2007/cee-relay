const express = require('express');
const axios = require('axios');
const { SocksProxyAgent } = require('socks-proxy-agent');

const app = express();
const PORT = process.env.PORT || 10000;

let currentProxyAgent = null;
let lastProxyCheckTime = 0;

// وظيفة لجلب قوائم بروكسيات مجانية من مصادر مفتوحة على الويب
async function fetchPublicProxies() {
  try {
    console.log('[Proxy Auto-Fetcher] جاري جلب قوائم البروكسيات من الويب...');
    // مصادر عامة ومجانية لجلب بروتوكول SOCKS5
    const sources = [
      'https://raw.githubusercontent.com/hookzof/socks5_list/master/proxy.txt',
      'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt'
    ];

    let proxies = [];
    for (const url of sources) {
      try {
        const res = await axios.get(url, { timeout: 5000 });
        if (res.status === 200 && typeof res.data === 'string') {
          const lines = res.data.split('\n');
          for (let line of lines) {
            line = line.trim();
            if (line && line.includes(':')) {
              proxies.push(`socks5://${line}`);
            }
          }
        }
      } catch (err) {
        // تخطي المصدر في حال تعذر الاتصال به
      }
    }
    // إرجاع أول 50 بروكسي فقط لتسريع عملية الفحص
    return [...new Set(proxies)].slice(0, 50);
  } catch (e) {
    console.log('[Proxy Auto-Fetcher] خطأ في جلب القوائم:', e.message);
    return [];
  }
}

// وظيفة لفحص بروكسي معين والتأكد من أنه حي
async function testProxy(proxyUrl) {
  try {
    const agent = new SocksProxyAgent(proxyUrl);
    const response = await axios.get('https://cee.buzz/api/android/transcoddedFiles/id/3130508', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer': 'https://cee.buzz/'
      },
      httpAgent: agent,
      httpsAgent: agent,
      timeout: 4000 // مهلة سريعة جداً 4 ثوانٍ
    });
    
    if (response.status === 200) {
      console.log(`[Proxy Checker] نجح الفحص، بروكسي صالح: ${proxyUrl}`);
      return true;
    }
  } catch (e) {
    // البروكسي لا يعمل
  }
  return false;
}

// وظيفة بحث وتحديث بروكسي نشط تلقائياً
async function autoFindAndSetProxy() {
  // تجنب التكرار المستمر إذا تم الفحص حديثاً
  const now = Date.now();
  if (currentProxyAgent && (now - lastProxyCheckTime < 10 * 60 * 1000)) {
    return true; // البروكسي الحالي ساري ولم يمضِ على فحصه 10 دقائق
  }

  const list = await fetchPublicProxies();
  if (!list.length) return false;

  console.log(`[Proxy Auto-Fetcher] تم جلب ${list.length} بروكسي، جاري الفحص...`);
  
  for (const p of list) {
    const isValid = await testProxy(p);
    if (isValid) {
      currentProxyAgent = new SocksProxyAgent(p);
      lastProxyCheckTime = Date.now();
      return true;
    }
  }

  console.log('[Proxy Auto-Fetcher] لم يتم العثور على بروكسي صالح من القائمة الحالية.');
  return false;
}

// مسار جلب تفاصيل الفيديو
app.get('/api/get-stream', async (req, res) => {
  let id = req.query.id;
  if (!id && req.query.url) {
    const match = req.query.url.match(/(\d{6,8})/);
    if (match) id = match[1];
  }
  if (!id) return res.status(400).json({ status: 'error', message: 'معرف مطلوب' });

  const filesApi = `https://cee.buzz/api/android/transcoddedFiles/id/${id}`;

  try {
    // التأكد من وجود بروكسي فعال ومفحوص مسبقاً
    if (!currentProxyAgent) {
      await autoFindAndSetProxy();
    }

    let response;
    try {
      response = await axios.get(filesApi, {
        headers: { 
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 
          'Referer': 'https://cee.buzz/' 
        },
        httpAgent: currentProxyAgent, 
        httpsAgent: currentProxyAgent, 
        timeout: 8000
      });
    } catch (netErr) {
      console.log('[API] فشل الطلب، البروكسي الحالي مات أو حُظر. جاري البحث عن بديل فوراً...');
      currentProxyAgent = null;
      await autoFindAndSetProxy();

      // إعادة المحاولة بالبروكسي الجديد المكتشف تلقائياً
      response = await axios.get(filesApi, {
        headers: { 
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 
          'Referer': 'https://cee.buzz/' 
        },
        httpAgent: currentProxyAgent, 
        httpsAgent: currentProxyAgent, 
        timeout: 8000
      });
    }

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
    res.status(500).json({ status: 'error', message: `خطأ نهائي: ${err.message}` });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  // بحث أولي في الخلفية عند الإقلاع
  autoFindAndSetProxy();
});
