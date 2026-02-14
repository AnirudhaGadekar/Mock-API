
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Redis = require('ioredis');

const redis = new Redis(process.env.REDIS_URL);
const endpointId = '6a7e0798-eb00-4079-ade5-510f2422778f';
const key = `mockurl:chaos:${endpointId}`;

async function main() {
    const config = await redis.get(key);
    console.log('Current Chaos Config:', config);

    if (config) {
        console.log('Clearing chaos config...');
        await redis.del(key);
        console.log('Chaos config cleared.');
    } else {
        console.log('No chaos config found.');
    }
}

main()
    .catch(console.error)
    .finally(() => redis.quit());
