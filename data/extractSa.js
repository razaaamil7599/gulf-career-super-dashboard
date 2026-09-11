const fs = require('fs');
const path = require('path');

function extract() {
  const dumpPath = path.join(__dirname, '..', 'tmp', 'full_env_dump.txt');
  const outPath = path.join(__dirname, '..', 'tmp', 'old_service_account.json');

  try {
    // Read the file (likely UTF-16LE from PowerShell)
    let content = fs.readFileSync(dumpPath, 'utf16le');
    
    // The format is like {'name': '...'}, {'name': '...'}
    const matches = content.match(/'name': 'FIREBASE_SERVICE_ACCOUNT', 'value': '(.+?)'}/);
    if (matches && matches[1]) {
      let jsonStr = matches[1];
      // The shell might have escaped backslashes, let's fix them
      // We want to parse the inner JSON
      const sa = JSON.parse(jsonStr);
      fs.writeFileSync(outPath, JSON.stringify(sa, null, 2));
      console.log('✅ Service account extracted to tmp/old_service_account.json');
    } else {
      console.error('❌ Could not find FIREBASE_SERVICE_ACCOUNT in dump.');
      // Try searching for the key directly if it's not in that format
      if (content.includes('FIREBASE_SERVICE_ACCOUNT')) {
          console.log('Found the key, but regex failed. Content snippet:', content.substring(content.indexOf('FIREBASE_SERVICE_ACCOUNT'), content.indexOf('FIREBASE_SERVICE_ACCOUNT') + 100));
      }
    }
  } catch (err) {
    console.error('❌ Extraction failed:', err.message);
  }
}

extract();
