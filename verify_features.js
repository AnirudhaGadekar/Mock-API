
import WebSocket from 'ws';

const BASE_URL = 'http://localhost:3000';
const ENDPOINT_SUBDOMAIN = 'test-proxy-' + Date.now();
const TARGET_URL = 'https://jsonplaceholder.typicode.com';

async function test() {
    console.log('--- Starting Verification ---');

    // 0. Create Session
    console.log('0. Creating Session...');
    const sessionRes = await fetch(`${BASE_URL}/api/v1/session`, {
        method: 'POST'
    });
    const sessionData = await sessionRes.json();
    const apiKey = sessionData.session.apiKey;
    console.log(`   Session created, API Key: ${apiKey}`);

    // 1. Create Endpoint
    console.log('1. Creating Endpoint...');
    const createRes = await fetch(`${BASE_URL}/api/v1/endpoints/create`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-API-Key': apiKey
        },
        body: JSON.stringify({ name: ENDPOINT_SUBDOMAIN })
    });
    const resBody = await createRes.json();
    console.log('Create Response:', createRes.status, JSON.stringify(resBody));
    const endpoint = resBody.endpoint;
    if (!endpoint) throw new Error('Endpoint not created');
    console.log(`   Endpoint created: ${endpoint.id} (${endpoint.name})`);

    // 2. Connect WebSocket
    console.log('2. Connecting WebSocket...');
    const ws = new WebSocket(`${BASE_URL.replace('http', 'ws')}/api/ws?endpointId=${endpoint.id}`);

    const wsPromise = new Promise((resolve, reject) => {
        ws.on('open', () => console.log('   WS Connected'));
        ws.on('message', (data) => {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'REQUEST_LOG') {
                console.log('   WS Received Request Log:', msg.payload.path);
                resolve(msg.payload);
            }
        });
        setTimeout(() => reject(new Error('WS Timeout')), 5000);
    });

    // 3. Configure Proxy
    console.log('3. Configuring Proxy...');
    await fetch(`${BASE_URL}/api/v1/endpoints/${endpoint.id}`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            'X-API-Key': apiKey
        },
        body: JSON.stringify({ settings: { targetUrl: TARGET_URL } })
    });
    console.log(`   Proxy target set to ${TARGET_URL}`);

    // 4. Trigger Proxy Request (should hit jsonplaceholder)
    console.log('4. Triggering Proxy Request...');
    // We need to use the hostname routing or path routing. 
    // In dev, usually path routing: localhost:3000/api/v1/endpoints/mock does not exist?
    // Wait, mock.router.ts handles `*`.
    // But in dev, usually we access `http://localhost:3000/${subdomain}/todos/1`.

    // Let's check how mock router extracts subdomain.
    // It supports path-based in dev if hostname doesn't match allowed domains.
    const res = await fetch(`${BASE_URL}/${ENDPOINT_SUBDOMAIN}/todos/1`);
    const data = await res.json();

    console.log('   Proxy Response Status:', res.status);
    console.log('   Proxy Response Body ID:', data.id);

    if (res.status === 200 && data.id === 1) {
        console.log('✅ Proxy verified!');
    } else {
        console.error('❌ Proxy failed!');
        process.exit(1);
    }

    // 5. Verify WS Event
    console.log('5. Verifying WS Event...');
    try {
        const event = await wsPromise;
        if (event.path === '/todos/1' && event.responseStatus === 200) {
            console.log('✅ WS Inspector verified!');
        } else {
            console.error('❌ WS Event mismatch', event);
            process.exit(1);
        }
    } catch (e) {
        console.error('❌ WS Verification failed:', e.message);
        process.exit(1);
    }

    ws.close();
    console.log('--- Verification Complete ---');
}

test().catch(e => {
    console.error(e);
    process.exit(1);
});
