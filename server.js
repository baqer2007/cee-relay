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
    const media = await fetchFullMediaDetails(id, agent);
    
    res.json({
      status: 'success',
      video_id: id,
      video_url: `https://${req.get('host')}/api/stream-proxy?url=${encodeURIComponent(media.defaultUrl)}`,
      qualities: media.qualities.map(q => ({
        resolution: q.resolution,
        url: `https://${req.get('host')}/api/stream-proxy?url=${encodeURIComponent(q.url)}`
      })),
      subtitles: media.subtitles.map(s => ({
        lang: s.lang,
        url: `https://${req.get('host')}/api/sub-proxy?url=${encodeURIComponent(s.url)}`
      }))
    });
  } catch (err) {
    // إرسال الخطأ بالتفصيل لتفهّم سبب الـ 500 مباشرة من التطبيق
    res.status(500).json({
      status: 'error',
      message: `خطأ داخلي: ${err.message}`,
      stack: err.stack
    });
  }
});
