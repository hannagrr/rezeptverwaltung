const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const url = require('url');
const { createClient } = require("webdav");

require('dotenv').config();

const PORT = process.env.PORT || 3000;

// Prüfe ob WebDAV (Koofr) verwendet wird
const USE_WEBDAV = process.env.WEBDAV_URL && process.env.WEBDAV_URL.length > 0;

let webdavClient = null;

if (USE_WEBDAV) {
    console.log("Verbinde zu WebDAV...");
    webdavClient = createClient(
        process.env.WEBDAV_URL,
        {
            username: process.env.KOOFR_USER,
            password: process.env.KOOFR_PASS
        }
    );
    
    // Test-Abruf (optional, zum Prüfen)
    webdavClient.getDirectoryContents('/')
        .then(() => console.log("WebDAV Verbindung erfolgreich!"))
        .catch(e => console.error("WebDAV Verbindungsfehler:", e));
}

// Für WebDAV: klare, explizite DAV-Pfade
const REZEPTE_FILE = '/rezepte.json';
const TO_BE_COOKED_FILE = '/to_be_cooked.json';
const TO_BE_BOUGHT_FILE = '/to_be_bought.json';

// ---------- Datei-Hilfsfunktionen (mit WebDAV Support) ----------

async function readJSON(filepath) {
    try {
        let data;
        if (USE_WEBDAV) {
            // Lese von Koofr via WebDAV
            data = await webdavClient.getFileContents(filepath, { format: 'text' });
        } else {
            // Lese lokal
            data = await fs.readFile(filepath, 'utf8');
        }
        
        const parsed = JSON.parse(data);
        if (filepath === REZEPTE_FILE) {
            let rezepte = parsed.rezepte || parsed;
            rezepte = rezepte.map((rezept, index) => ({
                ...rezept,
                id: rezept.id || index + 1
            }));
            return rezepte;
        }
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        if (error.code === 'ENOENT' || error.status === 404) return [];
        throw error;
    }
}

async function writeJSON(filepath, data) {
    const content = JSON.stringify(data, null, 2);
    
    if (USE_WEBDAV) {
        // Schreibe zu Koofr via WebDAV
        await webdavClient.putFileContents(filepath, content, { overwrite: true });
    } else {
        // Schreibe lokal
        await fs.writeFile(filepath, content, 'utf8');
    }
}

// ---------- Zutaten-Logik ----------

function parseIngredient(zutatString) {
    const match = zutatString.match(/^([\d.,½¼¾⅓⅔⅛⅜⅝⅞]+\s*[a-zA-ZäöüÄÖÜß().]*)\s+(.+)$/);
    if (match) return { amount: match[1].trim(), name: match[2].trim() };
    return { amount: '', name: zutatString.trim() };
}

function mergeIngredients(zutaten) {
    const merged = new Map();
    zutaten.forEach(zutat => {
        const parsed = parseIngredient(zutat.name);
        const key = parsed.name.toLowerCase();
        if (merged.has(key)) {
            const ex = merged.get(key);
            if (parsed.amount) ex.amounts.push(parsed.amount);
            if (zutat.rezeptName) ex.rezepte.add(zutat.rezeptName);
            if (zutat.rezeptId != null) ex.rezeptIds.add(zutat.rezeptId);
        } else {
            const rezepte = new Set();
            const rezeptIds = new Set();
            if (zutat.rezeptName) rezepte.add(zutat.rezeptName);
            if (zutat.rezeptId != null) rezeptIds.add(zutat.rezeptId);
            merged.set(key, {
                baseName: parsed.name,
                amounts: parsed.amount ? [parsed.amount] : [],
                rezepte, rezeptIds
            });
        }
    });
    return Array.from(merged.values()).map(item => ({
        name: item.amounts.length > 0
            ? item.amounts.join(' + ') + ' ' + item.baseName
            : item.baseName,
        baseName: item.baseName,
        amounts: item.amounts,
        rezeptIds: Array.from(item.rezeptIds),
        rezeptNames: Array.from(item.rezepte)
    }));
}

function expandIngredients(toBeBought) {
    const expanded = [];
    toBeBought.forEach(z => {
        const baseName = z.baseName || z.name;
        if (z.rezeptIds && z.rezeptIds.length > 0) {
            z.rezeptIds.forEach((id, idx) => {
                const amount = (z.amounts && z.amounts[idx]) || '';
                expanded.push({
                    name: amount ? amount + ' ' + baseName : baseName,
                    rezeptId: id,
                    rezeptName: (z.rezeptNames && z.rezeptNames[idx]) || ''
                });
            });
        } else {
            expanded.push({ name: z.name, rezeptId: null, rezeptName: null });
        }
    });
    return expanded;
}

// ---------- HTTP-Infrastruktur ----------

function setCORS(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJSON(res, data, status = 200) {
    setCORS(res);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

function sendError(res, message, status = 500) {
    sendJSON(res, { error: message }, status);
}

async function getRequestBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try { resolve(body ? JSON.parse(body) : {}); }
            catch (e) { reject(e); }
        });
        req.on('error', reject);
    });
}

// ---------- Router ----------

const server = http.createServer(async (req, res) => {
    const pathname = url.parse(req.url).pathname;
    const method = req.method;

    if (method === 'OPTIONS') { setCORS(res); res.writeHead(204); res.end(); return; }

    try {
        // Statische Dateien: index.html + Bilder aus images/
        if (pathname === '/' || pathname === '/index.html') {
            const html = await fs.readFile(path.join(__dirname, 'index.html'));
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(html);
            return;
        }
        if (pathname.startsWith('/images/')) {
            const imgPath = path.join(__dirname, 'images', path.basename(pathname));
            try {
                const imgData = await fs.readFile(imgPath);
                const ext = path.extname(pathname).toLowerCase();
                const mimeTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
                res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
                res.end(imgData);
            } catch (e) {
                sendError(res, 'Image not found', 404);
            }
            return;
        }

        // GET /api/rezepte
        if (pathname === '/api/rezepte' && method === 'GET') {
            sendJSON(res, await readJSON(REZEPTE_FILE));
        }
        // GET /api/to-be-cooked
        else if (pathname === '/api/to-be-cooked' && method === 'GET') {
            sendJSON(res, await readJSON(TO_BE_COOKED_FILE));
        }
        // GET /api/to-be-bought
        else if (pathname === '/api/to-be-bought' && method === 'GET') {
            sendJSON(res, await readJSON(TO_BE_BOUGHT_FILE));
        }

        // POST /api/to-be-cooked
        else if (pathname === '/api/to-be-cooked' && method === 'POST') {
            const rezept = await getRequestBody(req);
            const toBeCooked = await readJSON(TO_BE_COOKED_FILE);
            const toBeBought = await readJSON(TO_BE_BOUGHT_FILE);

            toBeCooked.push(rezept);
            await writeJSON(TO_BE_COOKED_FILE, toBeCooked);

            const neueZutaten = rezept.zutaten.map(z => ({
                name: z, rezeptId: rezept.id, rezeptName: rezept.name
            }));
            const merged = mergeIngredients([...expandIngredients(toBeBought), ...neueZutaten]);
            await writeJSON(TO_BE_BOUGHT_FILE, merged);

            sendJSON(res, { success: true });
        }

        // DELETE /api/to-be-cooked/:id
        else if (pathname.startsWith('/api/to-be-cooked/') && method === 'DELETE') {
            const rezeptId = parseInt(pathname.split('/').pop());
            const toBeCooked = await readJSON(TO_BE_COOKED_FILE);
            const toBeBought = await readJSON(TO_BE_BOUGHT_FILE);

            const rezeptToDelete = toBeCooked.find(r => r.id === rezeptId);
            
            await writeJSON(TO_BE_COOKED_FILE, toBeCooked.filter(r => r.id !== rezeptId));

            const currentBoughtBaseNames = new Set(
                toBeBought.map(z => (z.baseName || z.name).toLowerCase())
            );

            const alreadyBought = [];
            if (rezeptToDelete && rezeptToDelete.zutaten) {
                rezeptToDelete.zutaten.forEach(zutatStr => {
                    const parsed = parseIngredient(zutatStr);
                    const baseName = parsed.name.toLowerCase();
                    if (!currentBoughtBaseNames.has(baseName)) {
                        alreadyBought.push({
                            name: zutatStr,
                            baseName: parsed.name,
                            rezeptId: rezeptId,
                            rezeptName: rezeptToDelete.name
                        });
                    }
                });
            }

            const bleiben = [];
            toBeBought.forEach(z => {
                const ids = z.rezeptIds || [];
                if (ids.length === 0) { bleiben.push(z); return; }

                const bleibendeIds = ids.filter(id => id !== rezeptId);
                if (bleibendeIds.length > 0) {
                    const bleibendeNames = [];
                    ids.forEach((id, idx) => { if (id !== rezeptId) bleibendeNames.push((z.rezeptNames || [])[idx]); });
                    bleiben.push({ ...z, rezeptIds: bleibendeIds, rezeptNames: bleibendeNames });
                }
            });

            const merged = mergeIngredients(expandIngredients(bleiben));
            await writeJSON(TO_BE_BOUGHT_FILE, merged);

            sendJSON(res, { success: true, alreadyBoughtIngredients: alreadyBought });
        }

        // POST /api/to-be-bought
        else if (pathname === '/api/to-be-bought' && method === 'POST') {
            const zutat = await getRequestBody(req);
            const toBeBought = await readJSON(TO_BE_BOUGHT_FILE);
            const merged = mergeIngredients([...expandIngredients(toBeBought), zutat]);
            await writeJSON(TO_BE_BOUGHT_FILE, merged);
            sendJSON(res, { success: true });
        }

        // DELETE /api/to-be-bought/:index
        else if (pathname.startsWith('/api/to-be-bought/') && method === 'DELETE') {
            const index = parseInt(pathname.split('/').pop());
            const toBeBought = await readJSON(TO_BE_BOUGHT_FILE);
            toBeBought.splice(index, 1);
            await writeJSON(TO_BE_BOUGHT_FILE, toBeBought);
            sendJSON(res, { success: true });
        }

        // PUT /api/to-be-bought/:index
        else if (pathname.startsWith('/api/to-be-bought/') && method === 'PUT') {
            const index = parseInt(pathname.split('/').pop());
            const { newName } = await getRequestBody(req);
            const toBeBought = await readJSON(TO_BE_BOUGHT_FILE);

            if (index >= 0 && index < toBeBought.length && newName) {
                toBeBought[index].name = newName;
                const parsed = parseIngredient(newName);
                toBeBought[index].baseName = parsed.name;
            }
            await writeJSON(TO_BE_BOUGHT_FILE, toBeBought);
            sendJSON(res, { success: true });
        }

        else { sendError(res, 'Not Found', 404); }

    } catch (error) {
        console.error('Server Error:', error);
        sendError(res, error.message);
    }
});

server.listen(PORT, () => {
    console.log(`Server läuft auf Port ${PORT}`);
    console.log(`WebDAV aktiv: ${USE_WEBDAV}`);
});
