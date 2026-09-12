const https = require('https');
const req = https.get('https://ranamusic-backend.onrender.com/health', { rejectUnauthorized: false }, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Body:', data);
  });
});
req.on('error', (e) => {
  console.error('Error:', e.message);
});