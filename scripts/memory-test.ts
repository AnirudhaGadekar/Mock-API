function format(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

console.log('🧠 Starting memory test...');

const initial = process.memoryUsage().heapUsed;

// Simulate memory-intensive operations
const objects = [];
for (let i = 0; i < 5000; i++) {
  objects.push({
    id: i,
    data: new Array(50).fill(0).map(() => Math.random()),
    timestamp: Date.now(),
    nested: {
      level1: { level2: { level3: { data: `item-${i}` } } }
    }
  });
}

// Force garbage collection if available
if (global.gc) {
  global.gc();
} else {
  console.warn('⚠️  Garbage collection not available. Run with --expose-gc for accurate results.');
}

const after = process.memoryUsage().heapUsed;

console.log('Initial heap:', format(initial));
console.log('After operations:', format(after));
console.log('Growth:', format(after - initial));

// Check for memory leak (more than 50% growth is suspicious for this test)
const growthRatio = after / initial;
if (growthRatio > 1.5) {
  console.error(`❌ Possible memory leak detected. Growth ratio: ${growthRatio.toFixed(2)}`);
  process.exit(1);
}

console.log('✅ Memory usage is stable.');

// Clean up objects
objects.length = 0;

// Final GC check
if (global.gc) {
  global.gc();
  const final = process.memoryUsage().heapUsed;
  console.log('After cleanup:', format(final));
  
  if (final > initial * 1.3) {
    console.warn('⚠️  Memory not fully released after cleanup');
  }
}
