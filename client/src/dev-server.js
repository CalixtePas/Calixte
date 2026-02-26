import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8'
};

const server = createServer(async (req, res) => {
  const url = req.url === '/' ? '/index.html' : req.url;
  const file = join(root, url || '/index.html');

  try {
    const content = await readFile(file);
    res.statusCode = 200;
    res.setHeader('Content-Type', mime[extname(file)] || 'text/plain; charset=utf-8');
    res.end(content);
  } catch {
    res.statusCode = 404;
    res.end('Not found');
  }
});

server.listen(5173, '0.0.0.0', () => {
  console.log('Calixte client listening on http://localhost:5173');
});
