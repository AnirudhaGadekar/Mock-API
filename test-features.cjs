const http = require('http');

const API_URL = 'http://localhost:3000';
const ADMIN_SECRET = 'supersecretadminkey123';

async function request(method, path, headers = {}, body = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, API_URL);
        const options = {
            method,
            headers: {
                'Content-Type': 'application/json',
                ...headers
            }
        };

        const req = http.request(url, options, (res) => {
            let data = '';
            res.setEncoding('utf8');
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: data ? JSON.parse(data) : null });
                } catch (e) {
                    resolve({ status: res.statusCode, data });
                }
            });
        });

        req.on('error', (err) => {
            console.error(`Request Error (${method} ${path}):`, err.message);
            reject(err);
        });

        req.write(JSON.stringify(body || {}));
        req.end();
    });
}

async function test() {
    console.log('--- Starting Backend Features Test (Skipping Latency) ---');

    // 1. Session
    const s = await request('POST', '/api/v1/session');
    const apiKey = s.data.session.apiKey;
    const headers = { 'X-API-Key': apiKey };
    console.log('1. Session Created:', apiKey.substring(0, 10) + '...');

    // 2. Create Endpoint
    const name = 'test-' + Math.floor(Math.random() * 1000000);
    const e = await request('POST', '/api/v1/endpoints/create', headers, { name });
    const endpointId = e.data.endpoint.id;
    console.log('2. Endpoint Created:', name);

    // 3. State Store
    console.log('3. Testing State Store...');
    await request('POST', `/api/v1/state/${endpointId}/counter`, headers, { value: 99 });
    const val = await request('GET', `/api/v1/state/${endpointId}/counter`, headers);
    if (val.data && val.data.value === 99) {
        console.log('3. State Store: OK');
    } else {
        console.log('3. State Store: FAILED', val.data);
    }

    // 4. Admin Overview
    const admin = await request('GET', '/api/v1/admin/overview', { 'X-Admin-Secret': ADMIN_SECRET });
    if (admin.status === 200 && admin.data.success) {
        console.log('4. Admin Overview: OK (Endpoints:', admin.data.overview.endpoints, ')');
    } else {
        console.log('4. Admin Overview: FAILED', admin.status, admin.data);
    }

    console.log('--- Test Complete ---');
}

test().catch(err => {
    console.error('Fatal Test Error:', err.message);
});
