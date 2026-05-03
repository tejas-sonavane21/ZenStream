/**
 * StreamFlow Proxy Server
 * Bypasses CORS and hotlink restrictions for video streaming
 */

const http = require('http');
const https = require('https');
const url = require('url');
const path = require('path');
const fs = require('fs');

const PORT = 4000;

// ── Supabase Config ────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://caklaclowgwprjalnywk.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNha2xhY2xvd2d3cHJqYWxueXdrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg2Nzg2NTQsImV4cCI6MjA4NDI1NDY1NH0.zuymyh5-5WcUKSDYs8aMcf98C5UfLHk14KtQ9jSVr3A';

// ── LRU Search Cache ───────────────────────────────────────────────────────────
// Caches search queries for 5 minutes. Prevents memory bloat while keeping search fast.
const searchCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_SIZE = 500;

function getCachedSearch(query) {
    const cached = searchCache.get(query);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
        return cached.results;
    }
    return null;
}

function setCachedSearch(query, results) {
    if (searchCache.size >= MAX_CACHE_SIZE) {
        // Simple eviction: remove the first (oldest inserted) key
        const firstKey = searchCache.keys().next().value;
        searchCache.delete(firstKey);
    }
    searchCache.set(query, { results, timestamp: Date.now() });
}

function clearCache() {
    searchCache.clear();
}


// MIME types for serving static files
const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    
    // Add CORS headers to all responses
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }
    
    // Proxy endpoint: /proxy?url=VIDEO_URL
    if (pathname === '/proxy') {
        const videoUrl = parsedUrl.query.url;
        
        if (!videoUrl) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing url parameter' }));
            return;
        }
        
        console.log(`\n🎬 Proxying: ${videoUrl}`);
        
        try {
            await proxyVideo(videoUrl, req, res);
        } catch (error) {
            console.error('❌ Proxy error:', error.message);
            // Only send error if headers haven't been sent
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: error.message }));
            }
        }
        return;
    }

    // Search endpoint: /search?q=QUERY&limit=20
    if (pathname === '/search') {
        const q = (parsedUrl.query.q || '').trim();
        const limit = Math.min(parseInt(parsedUrl.query.limit) || 20, 50);

        if (!q) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify([]));
            return;
        }

        const cacheKey = `${q.toLowerCase()}:${limit}`;
        const cachedResults = getCachedSearch(cacheKey);
        
        if (cachedResults) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(cachedResults));
            return;
        }

        // Dynamic Supabase query using PostgREST ilike on multiple tokens
        const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
        let supabaseQuery = `${SUPABASE_URL}/rest/v1/movies?select=id,title,link&order=title.asc&limit=${limit}`;
        
        if (tokens.length === 1) {
            supabaseQuery += `&title=ilike.*${encodeURIComponent(tokens[0])}*`;
        } else if (tokens.length > 1) {
            const andClause = tokens.map(t => `title.ilike.*${encodeURIComponent(t)}*`).join(',');
            supabaseQuery += `&and=(${andClause})`;
        }

        try {
            const resDb = await fetch(supabaseQuery, {
                headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
            });
            const results = await resDb.json();
            
            if (resDb.ok) {
                setCachedSearch(cacheKey, results);
            }
            
            res.writeHead(resDb.ok ? 200 : resDb.status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(results));
        } catch (err) {
            console.error('Search error:', err.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    // Add movie endpoint: POST /movies/add  { title, link }
    if (pathname === '/movies/add' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
            try {
                const { title, link } = JSON.parse(body);
                if (!title || !link) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'title and link are required' }));
                    return;
                }
                const r = await fetch(`${SUPABASE_URL}/rest/v1/movies`, {
                    method: 'POST',
                    headers: {
                        apikey: SUPABASE_KEY,
                        Authorization: `Bearer ${SUPABASE_KEY}`,
                        'Content-Type': 'application/json',
                        Prefer: 'return=representation'
                    },
                    body: JSON.stringify({ title, link })
                });
                const data = await r.json();
                if (!r.ok) throw new Error(data?.message || r.statusText);
                // Clear search cache so new movies can be discovered immediately
                clearCache();
                res.writeHead(201, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, id: data[0].id }));
            } catch (err) {
                console.error('Add movie error:', err.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }

    let filePath = pathname === '/' ? '/index.html' : pathname;
    filePath = path.join(__dirname, filePath);
    
    // Security: prevent directory traversal
    if (!filePath.startsWith(__dirname)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }
    
    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    
    fs.readFile(filePath, (err, data) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404);
                res.end('File not found');
            } else {
                res.writeHead(500);
                res.end('Server error');
            }
            return;
        }
        
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
});

function proxyVideo(videoUrl, clientReq, clientRes) {
    return new Promise((resolve, reject) => {
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
                proxyVideo(redirectUrl, clientReq, clientRes)
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
                    resolve(); // Already streaming, just end
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
        
        clientRes.on('close', () => {
            proxyReq.destroy();
        });
        
        proxyReq.end();
    });
}

server.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════╗
║                                                        ║
║   🎬 StreamFlow Proxy Server                          ║
║                                                        ║
║   Open:   http://localhost:${PORT}                       ║
║   Proxy:  http://localhost:${PORT}/proxy?url=VIDEO_URL   ║
║   Search: http://localhost:${PORT}/search?q=MOVIE_NAME   ║
║                                                        ║
║   Press Ctrl+C to stop                                 ║
║                                                        ║
╚════════════════════════════════════════════════════════╝
    `);
});
