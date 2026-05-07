/**
 * StreamFlow Proxy - Vercel Serverless Function
 * Bypasses CORS and hotlink restrictions for video streaming
 */

const https = require('https');
const http = require('http');
const url = require('url');

module.exports = async (req, res) => {
    // Add CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const videoUrl = req.query.url;

    if (!videoUrl) {
        res.status(400).json({ error: 'Missing url parameter' });
        return;
    }

    console.log(`🎬 Proxying: ${videoUrl}`);

    try {
        await proxyVideo(videoUrl, req, res);
    } catch (error) {
        console.error('❌ Proxy error:', error.message);
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
    }
};

function proxyVideo(videoUrl, clientReq, clientRes, redirectCount = 0) {
    return new Promise((resolve, reject) => {
        // Prevent infinite redirects
        if (redirectCount > 5) {
            reject(new Error('Too many redirects'));
            return;
        }

        const parsedUrl = url.parse(videoUrl);
        const protocol = parsedUrl.protocol === 'https:' ? https : http;

        // Forward Range header for seeking support
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': '*/*',
            'Accept-Encoding': 'identity',
            'Connection': 'keep-alive',
            'Referer': `${parsedUrl.protocol}//${parsedUrl.hostname}/`
        };

        // Forward Range header for seeking
        if (clientReq.headers.range) {
            headers['Range'] = clientReq.headers.range;
            console.log(`📍 Range: ${clientReq.headers.range}`);
        }

        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
            path: parsedUrl.path,
            method: clientReq.method || 'GET',
            headers: headers,
            timeout: 30000
        };

        const proxyReq = protocol.request(options, (proxyRes) => {
            console.log(`📥 Response: ${proxyRes.statusCode}`);

            // Handle redirects
            if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
                let redirectUrl = proxyRes.headers.location;
                // Handle relative redirects
                if (redirectUrl.startsWith('/')) {
                    redirectUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}${redirectUrl}`;
                }
                console.log(`🔄 Redirect: ${redirectUrl}`);
                proxyVideo(redirectUrl, clientReq, clientRes, redirectCount + 1)
                    .then(resolve)
                    .catch(reject);
                return;
            }

            // Forward response headers
            const responseHeaders = {
                'Content-Type': proxyRes.headers['content-type'] || 'video/mp4',
                'Accept-Ranges': 'bytes',
                'Cache-Control': 'no-cache'
            };

            if (proxyRes.headers['content-length']) {
                responseHeaders['Content-Length'] = proxyRes.headers['content-length'];
            }

            if (proxyRes.headers['content-range']) {
                responseHeaders['Content-Range'] = proxyRes.headers['content-range'];
            }

            // Use appropriate status code
            const statusCode = proxyRes.statusCode;

            if (!clientRes.headersSent) {
                clientRes.writeHead(statusCode, responseHeaders);
            }

            // Pipe the video stream to client
            proxyRes.pipe(clientRes);

            proxyRes.on('end', () => {
                console.log('✅ Done');
                resolve();
            });

            proxyRes.on('error', (err) => {
                console.error('Stream error:', err.message);
                if (!clientRes.headersSent) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });

        proxyReq.on('timeout', () => {
            console.error('⏱️ Request timeout');
            proxyReq.destroy();
            reject(new Error('Request timeout'));
        });

        proxyReq.on('error', (err) => {
            console.error('Request error:', err.message);
            reject(err);
        });

        // Handle client disconnect
        clientReq.on('close', () => {
            proxyReq.destroy();
        });

        proxyReq.end();
    });
}
