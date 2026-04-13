const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;

// Content types list to ensure browsers parse the files safely
const MIME_TYPES = {
  default: 'application/octet-stream',
  html: 'text/html; charset=UTF-8',
  js: 'application/javascript; charset=UTF-8',
  css: 'text/css',
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  ico: 'image/x-icon',
  svg: 'image/svg+xml'
};

const server = http.createServer((req, res) => {
  // Setup file routing
  let filePath = req.url === '/' ? '/index.html' : req.url;
  
  // Extract extension for content type mapped routing
  const ext = path.extname(filePath).substring(1).toLowerCase();
  const absolutePath = path.join(__dirname, filePath);
  
  // Attempt to serve file from directory
  fs.readFile(absolutePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404);
        res.end('404 File Not Found');
      } else {
        res.writeHead(500);
        res.end('Server Error: ' + err.code);
      }
    } else {
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || MIME_TYPES.default });
      res.end(data);
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n==============================================`);
  console.log(`🚀 Local Server running at http://localhost:${PORT}`);
  console.log(`==============================================\n`);
});
