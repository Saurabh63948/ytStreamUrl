// const express = require('express');
// const axios = require('axios');
// const app = express();
// const PORT = 3000;

// // Configuration
// const RAPIDAPI_KEY = ''; 
// const RAPIDAPI_HOST = 'ytstream-download-youtube-videos.p.rapidapi.com';

// /**
//  * Helper function: YouTube URL se Video ID nikalne ke liye
//  */
// function getYoutubeVideoId(url) {
//     if (!url) return null;
//     const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
//     const match = url.match(regExp);
//     return (match && match[2].length === 11) ? match[2] : null;
// }

// /**
 
//  * Example URL: http://localhost:3000/get-video?url=https://www.youtube.com/watch?v=VIDEO_ID
//  */
// app.get('/get-video', async (req, res) => {
//     try {
//         const youtubeUrl = req.query.url;

//         if (!youtubeUrl) {
//             return res.status(400).json({
//                 success: false,
//                 error: 'Missing "url" query parameter'
//             });
//         }

//         const videoId = getYoutubeVideoId(youtubeUrl);

//         if (!videoId) {
//             return res.status(400).json({
//                 success: false,
//                 error: 'Invalid YouTube URL'
//             });
//         }

//         // RapidAPI Calling using Axios
//         const options = {
//             method: 'GET',
//             url: `https://${RAPIDAPI_HOST}/dl`,
//             params: { id: videoId },
//             headers: {
//                 'X-RapidAPI-Key': RAPIDAPI_KEY,
//                 'X-RapidAPI-Host': RAPIDAPI_HOST
//             }
//         };

//         const response = await axios.request(options);
//         const data = response.data;

//         if (!data) {
//             return res.status(500).json({
//                 success: false,
//                 error: 'Invalid API response from RapidAPI'
//             });
//         }

//         const title = data.title || 'Video';
        
//         // 1. Check karein kya ye Live Stream hai?
//         const isLive = data.isLive === true;
        
//         let mp4Url = null;
//         let hlsUrl = data.hlsManifestUrl || null; // Direct HLS check

//         let allFormats = [];
//         if (data.formats && Array.isArray(data.formats)) {
//             allFormats = [...allFormats, ...data.formats];
//         }
//         if (data.adaptiveFormats && Array.isArray(data.adaptiveFormats)) {
//             allFormats = [...allFormats, ...data.adaptiveFormats];
//         }

//         // Formats loop se URLs nikalna
//         for (const f of allFormats) {
//             // MP4 nikalne ke liye
//             if (f.mimeType && f.mimeType.includes('video/mp4') && f.url) {
//                 if (f.qualityLabel === '720p') {
//                     mp4Url = f.url;
//                     break; // Agar 720p mil gaya to loop break karein
//                 }
//                 if (!mp4Url) {
//                     mp4Url = f.url;
//                 }
//             }

//             // Agar loop ke andar m3u8 link mile
//             if (!hlsUrl && f.url && f.url.includes('.m3u8')) {
//                 hlsUrl = f.url;
//             }
//         }

//         // 2. Response Return Logic (Live vs Normal Video)
        
//         // Agar Video LIVE hai ya sirf HLS mila hai to use priority dein
//         if ((isLive || !mp4Url) && hlsUrl) {
//             return res.json({
//                 success: true,
//                 type: 'hls',
//                 is_live: true,
//                 video_url: hlsUrl,
//                 title: title
//             });
//         }

//         // Agar normal video hai aur MP4 mil gaya hai
//         if (mp4Url) {
//             return res.json({
//                 success: true,
//                 type: 'mp4',
//                 is_live: false,
//                 video_url: mp4Url,
//                 title: title
//             });
//         }

//         // Agar dono me se kuch nahi mila
//         return res.status(404).json({
//             success: false,
//             error: 'No playable stream found',
//             debug: {
//                 video_id: videoId,
//                 api_response: data
//             }
//         });

//     } catch (error) {
//         return res.status(500).json({
//             success: false,
//             error: error.message || 'Internal Server Error'
//         });
//     }
// });

// // Server Start
// app.listen(PORT, () => {
//     console.log(`Server running on http://localhost:${PORT}`);
// });
const express = require('express');
const YTDlpWrap = require('yt-dlp-wrap').default;
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

// Binary ka ek local path define karein taaki windows ko aasaani se mile
const binaryPath = path.join(__dirname, 'yt-dlp.exe'); 
const ytDlpWrap = new YTDlpWrap(binaryPath);

/**
 * Auto-downloader function: Agar yt-dlp.exe nahi hai, to ye use internet se chupchaap download kar lega
 */
async function setupYtdlp() {
    if (!fs.existsSync(binaryPath)) {
        console.log("FREEZE! yt-dlp.exe nahi mila. Github se download ho raha hai, thoda rukein...");
        try {
            await YTDlpWrap.downloadFromGithub(binaryPath);
            console.log("SUCCESS: yt-dlp.exe successfully download ho gaya hai!");
        } catch (err) {
            console.error("FAILED: yt-dlp download karne me error aaya:", err.message);
        }
    } else {
        console.log("DEBUG: Local yt-dlp.exe pehle se moojud hai.");
    }
}

/**
 * Core Function: Stream URL extract karne ke liye
 */
async function getStreamUrl(videoUrl) {
    const proxy = process.env.PROXY_URL;

    const args = [
        videoUrl,
        '--quiet',
        '--no-check-certificate',
        '--extractor-args', 'youtube:player_client=android,web,web_embedded,web_creator'
    ];

    if (proxy) {
        args.push('--proxy', proxy);
    }

    try {
        const info = await ytDlpWrap.getVideoInfo(args);

        const title = info.title || 'Video';
        const isLive = info.is_live || false;
        const formats = info.formats || [];

        // ==================================================
        // FIRST TRY: BEST MP4 FORMAT
        // ==================================================
        let bestMp4 = null;
        let bestHeight = 0;

        for (const f of formats) {
            if (f.ext === 'mp4' && f.url && f.vcodec !== 'none' && !['m3u8', 'm3u8_native'].includes(f.protocol)) {
                const height = f.height || 0;
                if (height > bestHeight) {
                    bestHeight = height;
                    bestMp4 = f;
                }
            }
        }

        if (bestMp4) {
            return {
                status: "success",
                type: "video",
                title: title,
                is_live: isLive,
                quality: `${bestMp4.height}p`,
                stream_url: bestMp4.url
            };
        }

        // ==================================================
        // SECOND TRY: DIRECT URL
        // ==================================================
        if (info.url && !info.url.includes('.m3u8')) {
            return {
                status: "success",
                type: "video",
                title: title,
                is_live: isLive,
                stream_url: info.url
            };
        }

        // ==================================================
        // THIRD TRY: HLS (LIVE STREAMS)
        // ==================================================
        for (const f of formats) {
            if (['m3u8', 'm3u8_native'].includes(f.protocol) && f.url) {
                return {
                    status: "success",
                    type: "hls",
                    title: title,
                    is_live: isLive,
                    stream_url: f.url
                };
            }
        }

        return "No playable stream found";

    } catch (error) {
        console.error("ERROR:", error.message);
        return error.message;
    }
}

app.get('/get-video', async (req, res) => {
    const videoUrl = req.query.url;

    if (!videoUrl) {
        return res.status(400).json({ status: "error", message: "URL parameter missing" });
    }

    const result = await getStreamUrl(videoUrl);

    if (result && typeof result === 'object' && result.status === 'success') {
        return res.json(result);
    }

    return res.status(500).json({
        status: "error",
        message: "Failed to extract stream URL",
        details: result
    });
});

// Server Start hone se pehle check karenge binary ko
app.listen(PORT, async () => {
    await setupYtdlp(); // Binary download invoke karein
    console.log(`Server running on http://localhost:${PORT}`);
});