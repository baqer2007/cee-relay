const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/api/get-stream', async (req, res) => {
  let id = req.query.id;
  try {
    const filesApi = `https://cee.buzz/api/android/transcoddedFiles/id/${id}`;
    const response = await axios.get(filesApi, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer': 'https://cee.buzz/',
        'Origin': 'https://cee.buzz'
      },
      timeout: 10000
    });
    
    let filesData = response.data;
    if (typeof filesData === 'string') filesData = JSON.parse(filesData);
    const list = Array.isArray(filesData) ? filesData : (filesData.videos || []);
    
    res.json({
      status: 'success',
      video_url: list[0]?.videoUrl || list[0]?.url,
      qualities: list.map(q => ({ resolution: q.resolution || 'Auto', url: q.videoUrl || q.url }))
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.listen(PORT, () => console.log(`Server running on ${PORT}`));
