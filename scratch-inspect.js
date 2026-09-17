import { MoodleClient } from './src/services/moodle.service.js';
import * as cheerio from 'cheerio';

async function run() {
  const client = new MoodleClient();
  await client.login('24050126', 'BDU240258');

  console.log('\n--- Inspecting SCORM 21429 (Unit 7 Journeys: Vocabulary Focus) ---');
  const viewRes = await client.request('/mod/scorm/view.php?id=21429');
  const $ = cheerio.load(viewRes.data);

  console.log('Page Title:', $('h1, .page-header-headings').first().text().trim());

  // Check form inputs and links
  const forms = $('form').map((_, el) => ({
    action: $(el).attr('action'),
    inputs: $(el).find('input').map((_, i) => ({ name: $(i).attr('name'), value: $(i).attr('value') })).get()
  })).get();
  console.log('Forms:', JSON.stringify(forms, null, 2));

  const playerLink = $('a[href*="player.php"]').attr('href');
  console.log('Player link:', playerLink);

  // If launch form exists, launch it
  const launchForm = $('form[action*="player.php"]').first();
  if (launchForm.length > 0) {
    const action = launchForm.attr('action');
    const params = new URLSearchParams();
    launchForm.find('input').each((_, el) => {
      const name = $(el).attr('name');
      if (name) params.set(name, $(el).val() || '');
    });
    console.log('Posting launch form to:', action, params.toString());
    const launchRes = await client.request(action, {
      method: 'POST',
      data: params.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    const $player = cheerio.load(launchRes.data);
    console.log('Player title:', $player('title').text().trim());
    const scripts = $player('script').map((_, el) => $player(el).html()).get();
    for (const s of scripts) {
      if (!s) continue;
      if (s.includes('scoid') || s.includes('datamodel') || s.includes('cmi') || s.includes('scorm')) {
        console.log('[MATCHED PLAYER SCRIPT]:\n', s.slice(0, 700));
      }
    }
  }
}

run().catch(err => console.error('ERROR:', err));
