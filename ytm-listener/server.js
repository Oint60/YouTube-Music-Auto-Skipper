const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8000;
const directory = path.join(__dirname, 'app', 'build', 'outputs', 'apk', 'debug');

http.createServer((req, res) => {
    const filePath = path.join(directory, 'app-debug.apk');
    if (req.url === '/app-debug.apk') {
        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(404);
                res.end(JSON.stringify(err));
                return;
            }
            res.writeHead(200, {
                'Content-Type': 'application/vnd.android.package-archive',
                'Content-Disposition': 'attachment; filename="app-debug.apk"'
            });
            res.end(data);
        });
    } else {
        res.writeHead(404);
        res.end("Not Found");
    }
}).listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT}`);
});
