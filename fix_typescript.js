const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src', 'index.ts');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Fix tool parameter access
content = content.replace(/params\.arguments/g, 'params');

// 2. Fix notification method (server.notification -> server.server.notification)
content = content.replace(/(server)\.notification/g, '$1.server.notification');

// 3. Remove duplicated runServer function by finding all occurrences
const runServerStart = 'async function runServer()';
const firstStartIdx = content.indexOf(runServerStart);
const secondStartIdx = content.indexOf(runServerStart, firstStartIdx + 1);

if (secondStartIdx !== -1) {
  // Find the end of the second implementation
  let braceCount = 1;
  let endIdx = content.indexOf('{', secondStartIdx) + 1;
  
  while (braceCount > 0 && endIdx < content.length) {
    const char = content.charAt(endIdx);
    if (char === '{') braceCount++;
    if (char === '}') braceCount--;
    endIdx++;
  }
  
  // Find the catch block after this (if any)
  const catchBlockStart = content.indexOf('runServer().catch', endIdx);
  if (catchBlockStart !== -1) {
    const catchBlockEnd = content.indexOf('});', catchBlockStart) + 3;
    // Remove the duplicate function and its catch block
    content = content.substring(0, secondStartIdx) + content.substring(catchBlockEnd);
  } else {
    // Just remove the duplicate function
    content = content.substring(0, secondStartIdx) + content.substring(endIdx);
  }
}

// Write the cleaned file
fs.writeFileSync(filePath, content);
console.log('Fixed TypeScript issues in src/index.ts');
