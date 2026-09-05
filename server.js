const express = require('express');
const axios = require('axios');
const { SocksProxyAgent } = require('socks-proxy-agent');

const app = express();
const PORT = process.env.PORT || 10000;

// إعداد وكيل SOCKS5 إذا تم تمرير المتغيرات
function getAgent() {
  const host = process.env.PROXY_HOST;
  const port = process.env.PROXY_PORT;
  if (host && port) {
    return new SocksProxyAgent(`socks5://${host}:${port}`);
  }
  return null;
}

// 1. مسار فحص الـ IP والبلد
app.get('/check-ip', async (req, res) => {
  const agent = getAgent();
  try {
    const config = agent ? { httpAgent: agent, httpsAgent: agent, timeout: 10000 } : { timeout: 10000 };
    const response = await axios.get('http://ip-api.com/json', config);
    res.json({
      status: 'success',
      proxy_used: agent ? `socks5://${process.env.PROXY_HOST}:${process.env.PROXY_PORT}` : 'none',
      detected_country: response.data.countryCode,
      detected_city: response.data.city,
      detected_ip: response.data.query,
      isp: response.data.isp
    });
  } catch (err) {
    res.status(500).json({
      status: 'failed',
      error: `تعذر الاتصال بالبروكسي: ${err.message}`,
      proxy: agent ? `socks5://${process.env.PROXY_HOST}:${process.env.PROXY_PORT}` : 'none'
    });
  }
});

// 2. مسار بث الفيديو وتمريره تلقائياً مع ترويسات المشغل
app.get('/stream', async (req, res) => {
  let targetUrl = req.query.url;

  if (!targetUrl) {
    return res.status(400).send('الرجاء تزويد رابط الفيديو عبر المعامل url');
  }

  // في حال تم تمرير الرابط بعد علامة الاستفهام دون ترميز
  const rawQuery = req.originalUrl.split('/stream?url=')[1];
  if (rawQuery) {
    targetUrl = rawQuery;
  }

  const agent = getAgent();

  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://cee.buzz/',
      'Origin': 'https://cee.buzz'
    };

    // تمرير ترويسة Range لتشغيل الفيديو والتقديم والتأخير
    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    const response = await axios({
      method: 'get',
      url: targetUrl,
      responseType: 'stream',
      headers: headers,
      httpAgent: agent,
      httpsAgent: agent,
      timeout: 30000,
      validateStatus: (status) => status >= 200 && status < 400
    });

    // تمرير ترويسات الاستجابة إلى المتصفح أو المشغل
    if (response.headers['content-range']) {
      res.setHeader('Content-Range', response.headers['content-range']);
    }
    if (response.headers['content-length']) {
      res.setHeader('Content-Length', response.headers['content-length']);
    }
    if (response.headers['accept-ranges']) {
      res.setHeader('Accept-Ranges', response.headers['accept-ranges']);
    } else {
      res.setHeader('Accept-Ranges', 'bytes');
    }

    res.setHeader('Content-Type', response.headers['content-type'] || 'video/mp4');
    res.status(response.status);

    response.data.pipe(res);

    response.data.on('error', (streamErr) => {
      console.error('خطأ أثناء تدفق البيانات:', streamErr.message);
      if (!res.headersSent) res.status(500).end();
    });

  } catch (err) {
    console.error('خطأ في سحب رابط الفيديو:', err.message);
    if (!res.headersSent) {
      res.status(500).json({
        status: 'error',
        message: 'تعذر جلب ملف الفيديو من السيرفر المصدر',
        details: err.message
      });
    }
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
