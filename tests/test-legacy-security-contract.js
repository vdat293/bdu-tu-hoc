import assert from 'node:assert/strict';
import fs from 'node:fs';

const api = fs.readFileSync('public/js/api.js', 'utf8');
const app = fs.readFileSync('public/js/app.js', 'utf8');

for (const signature of [
  'async formatDocx(token, formData)',
  'async loginEnglish(token, credentials)',
  'async getEnglishActivities(token, sessionId, courseId)',
  'async startEnglishExercise(token, sessionId, options)',
  'async stopEnglishExercise(token, sessionId)',
  'async closeEnglishSession(token, sessionId)',
  'async getEnglishAnswers(token)',
  'async saveEnglishAnswer(token, question, correctAnswer)',
  'async deleteEnglishAnswer(token, id)'
]) {
  assert.ok(api.includes(signature), `Missing legacy auth signature: ${signature}`);
}

assert.match(api, /formatDocx[\s\S]*Authorization.*Bearer \$\{token\}/);
assert.match(api, /loginEnglish[\s\S]*Authorization.*Bearer \$\{token\}/);
assert.match(app, /BduApi\.formatDocx\(AppState\.token, formData\)/);
assert.match(app, /BduApi\.loginEnglish\(token,/);
assert.match(app, /BduApi\.getEnglishActivities\(token,/);
assert.match(app, /BduApi\.closeEnglishSession\(AppState\.token, AppState\.englishSessionId\)/);
assert.match(app, /streamToken=\$\{encodeURIComponent\(streamToken \|\| ''\)\}/);
assert.match(app, /AppState\.englishStreamToken = session\.streamToken/);
assert.match(app, /downloadWordFmt|fetch\(downloadBtn\.href,[\s\S]*Authorization/);
assert.doesNotMatch(app, /downloadToken=\$\{encodeURIComponent/);
assert.doesNotMatch(app, /new EventSource\(`\/api\/english\/\$\{encodeURIComponent\(sessionId\)\}\/stream`\)/);
assert.match(app, /function resetLegacyUserScopedState\(\)/);
assert.match(app, /localStorage\.removeItem\('bdu_user_photo'\)/);
assert.match(app, /btn-download-docx[\s\S]*?removeAttribute\('href'\)/);
assert.match(app, /docx-file-input[\s\S]*?value = ''/);
assert.match(app, /english-answer-body[\s\S]*?textContent = ''/);
assert.match(app, /authGeneration/);
assert.match(app, /isCurrentLegacyAuth\(generation, token\)/);
assert.match(app, /AppState\.clans[\s\S]*?currentClan: null/);
assert.match(app, /AppState\.confession[\s\S]*?posts: \[\]/);
assert.match(app, /function reloadLegacyAfterLogout\(notice\)/);
assert.match(app, /function reloadLegacyAfterAccountChange\(key, notice\)/);
assert.match(app, /bdu_logout_notice/);
assert.match(app, /bdu_login_notice/);
assert.match(app, /window\.location\.reload\(\)/);

console.log('✅ Legacy WordFmt/English clients carry the required BDU auth and stream capability.');
