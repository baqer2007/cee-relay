const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { SocksProxyAgent } = require('socks-proxy-agent');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// تفعيل CORS لتمكين أي تطبيق موبايل أو متصفح من تشغيل الفيديو دون حظر
app.use(cors({
    origin: '*',
    methods: ['GET', 'HEAD', 'OPTIONS'],
    allowedHeaders: ['Range', 'Authorization', 'Content-Type', 'Accept']
}));

// إعداد البروكسي (يقرأ من متغيرات البيئة أو القيم الافتراضية للتجربة)
const PROXY_HOST = process.env.PROXY_HOST || 't.pinggy.io';
const PROXY_PORT = process.env.PROXY_PORT || '1080';
const SOCKS_URL = `socks5://${PROXY_HOST}:${PROXY_PORT}`;
const agent = new SocksProxyAgent(SOCKS_URL);

// 1. مسار الصفحة الرئيسية للتحقق من عمل السيرفر
app.get('/', (req, res) => {
    res.send('🚀 سيرفر تمرير بث CEE يعمل بنجاح على Render!');
});

// 2. مسار فحص صحة البروكسي وهوية الـ IP
app.get('/check-ip', async (req, res) => {
    try {
        const response = await axios.get('https://ipinfo.io/json', {
            httpAgent: agent,
            httpsAgent: agent,
            timeout: 8000
        });
        res.json({
            status: 'success',
            proxy_used: SOCKS_URL,
            detected_country: response.data.country,
            detected_city: response.data.city,
            detected_ip: response.data.ip,
            isp: response.data.org
        });
    } catch (error) {
        res.status(500).json({
            status: 'failed',
            error: 'تعذر الاتصال بالبروكسي: ' + error.message,
            proxy: SOCKS_URL
        });
    }
});

// 3. مسار بث وتمرير الفيديو الرئيسي (Stream Relay Endpoint)
// طريقة الاستخدام: /stream?url=ENCODED_VIDEO_URL
app.get('/stream', async (req, res) => {
    const videoUrl = req.query.url;

    if (!videoUrl) {
        return res.status(400).send('خطأ: يرجى تضمين رابط الفيديو عبر المعامل ?url=');
    }

    // تجهيز ترويسات الطلب وخاصة Range لدعم التقديم والترجيع
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://cee.buzz/'
    };

    if (req.headers.range) {
        headers['Range'] = req.headers.range;
    }

    try {
        const upstreamResponse = await axios({
            method: 'GET',
            url: videoUrl,
            httpAgent: agent,
            httpsAgent: agent,
            headers: headers,
            responseType: 'stream',
            timeout: 20000,
            validateStatus: (status) => status >= 200 && status < 400
        });

        // تمرير ترويسات الفيديو إلى العميل (الموبايل / المتصفح)
        const forwardHeaders = [
            'content-type',
            'content-length',
            'content-range',
            'accept-ranges',
            'last-modified',
            'etag'
        ];

        forwardHeaders.forEach((headerName) => {
            if (upstreamResponse.headers[headerName]) {
                res.setHeader(headerName, upstreamResponse.headers[headerName]);
            }
        });

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.status(upstreamResponse.status);

        // ربط تدفق الفيديو مباشرة نحو العميل
        upstreamResponse.data.pipe(res);

        upstreamResponse.data.on('error', (streamErr) => {
            console.error('خطأ أثناء تدفق البيانات:', streamErr.message);
            if (!res.headersSent) {
                res.status(500).end();
            }
        });

    } catch (err) {
        console.error('خطأ في سحب رابط الفيديو:', err.message);
        if (!res.headersSent) {
            res.status(502).json({
                error: 'فشل تمرير الفيديو عبر البروكسي',
                details: err.message
            });
        }
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
