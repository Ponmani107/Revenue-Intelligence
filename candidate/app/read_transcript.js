const fs = require('fs');
const readline = require('readline');
const fileStream = fs.createReadStream('C:\\Users\\PONMANI R\\.gemini\\antigravity-ide\\brain\\1a8c6829-1dd3-4309-8a9f-30ae50164326\\.system_generated\\logs\\transcript_full.jsonl');
const rl = readline.createInterface({ input: fileStream });
const lines = [];
rl.on('line', (line) => {
  lines.push(line);
  if (lines.length > 5) lines.shift();
});
rl.on('close', () => {
  lines.forEach((l) => {
    try {
      const obj = JSON.parse(l);
      console.log(`=== Step ${obj.step_index} (${obj.source} / ${obj.type}) ===`);
      if (obj.thinking) console.log('Thinking:', obj.thinking.slice(0, 300));
      if (obj.tool_calls) console.log('Tool calls:', JSON.stringify(obj.tool_calls, null, 2));
      if (obj.content) console.log('Content:', typeof obj.content === 'string' ? obj.content.slice(0, 500) : JSON.stringify(obj.content).slice(0, 500));
    } catch(e) {
      console.log('Error:', e.message);
    }
  });
});


