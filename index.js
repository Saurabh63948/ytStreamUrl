
const express = require('express');
let ytDlpWrap;
YTDlpWrap = require('yt-dlp-wrap').default;
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process'); // Linux permissions manage karne ke liye

const app = express();
const PORT = process.env.PORT || 5000;

// 1. Detect environment: Windows hai ya Linux (Render)
const isWindows = process.platform === 'win32';
const binaryName = isWindows ? 'yt-dlp.exe' : 'yt-dlp';
const binaryPath = path.join(__dirname, binaryName);

// Wrapper instance initialize karein sahi file extension ke sath
const ytDlpWrap = new YTDlpWrap(binaryPath);

/**
 * Auto-downloader function: Windows aur Render (Linux) dono ke liye compatible
 */
async function setupYtdlp() {
    if (!fs.existsSync(binaryPath)) {
        console.log(`FREEZE! ${binaryName} nahi mila. Github se download ho raha hai, thoda rukein...`);
        try {
            // GitHub se automatic platform ke hisab se exact file fetch hogi
            await YTDlpWrap.downloadFromGithub(binaryPath);
            console.log(`SUCCESS: ${binaryName} successfully download ho gaya hai!`);

            // Agar platform Linux (Render) hai, toh execute permission (chmod +x) dena padega
            if (!isWindows) {
                console.log("Linux (Render) platform detected. Setting executable permissions...");
                execSync(`chmod +x "${binaryPath}"`);
                console.log("Permissions set successfully!");
            }
        } catch (err) {
            console.error("FAILED: yt-dlp download karne me error aaya:", err.message);
        }
    } else {
        console.log(`DEBUG: Local ${binaryName} pehle se moojud hai.`);
        
        // Safe side check: Agar container rebuild ho rha ho aur binary cached ho
        if (!isWindows) {
            try {
                execSync(`chmod +x "${binaryPath}"`);
            } catch (e) {
                console.error("Permissions verify nahi ho payi:", e.message);
            }
        }
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
    await setupYtdlp(); // Automatic system ke according binary invoke karein
    console.log(`Server running on http://localhost:${PORT}`);
});
