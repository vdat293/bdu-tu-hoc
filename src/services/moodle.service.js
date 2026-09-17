import axios from 'axios';
import * as cheerio from 'cheerio';
import { CookieJar } from 'tough-cookie';

const MOODLE_URL = 'https://bdu.vn247.org';

/** Cookie-isolated Moodle client adapted from tool-do-eng-web/lib/moodle.js. */
export class MoodleClient {
  constructor() {
    this.baseUrl = MOODLE_URL;
    this.jar = new CookieJar();
  }

  async request(url, options = {}, redirects = 0) {
    if (redirects > 8) throw new Error('Moodle chuyển hướng quá nhiều lần.');
    const fullUrl = url.startsWith('http') ? url : `${this.baseUrl}${url}`;
    const cookie = await this.jar.getCookieString(fullUrl);
    const headers = {
      'User-Agent': 'Mozilla/5.0 AppleWebKit/537.36 Chrome/120 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'vi,en-US;q=0.9,en;q=0.8',
      ...options.headers
    };
    if (cookie) headers.Cookie = cookie;

    try {
      const response = await axios({
        url: fullUrl,
        method: options.method || 'GET',
        data: options.data,
        headers,
        maxRedirects: 0,
        timeout: 20_000,
        signal: options.signal,
        validateStatus: status => status >= 200 && status < 400
      });
      for (const value of response.headers['set-cookie'] || []) {
        await this.jar.setCookie(value, fullUrl);
      }
      if (response.status >= 300 && response.status < 400 && response.headers.location) {
        const destination = new URL(response.headers.location, fullUrl).href;
        const preserveMethod = response.status === 307 || response.status === 308;
        return this.request(destination, preserveMethod ? options : { method: 'GET', signal: options.signal }, redirects + 1);
      }
      return response;
    } catch (err) {
      if (err.response) {
        if (err.response.status === 404) {
          throw new Error(`Tài nguyên không tồn tại trên Moodle (HTTP 404: ${url}).`);
        }
        if (err.response.status === 403) {
          throw new Error(`Moodle từ chối truy cập (HTTP 403: ${url}).`);
        }
        throw new Error(`Lỗi phản hồi từ Moodle (HTTP ${err.response.status}): ${err.message}`);
      }
      throw err;
    }
  }

  async login(username, password, signal) {
    const loginPage = await this.request('/login/index.php', { signal });
    const $login = cheerio.load(loginPage.data);
    const params = new URLSearchParams({ username, password });
    const token = $login('input[name="logintoken"]').val();
    if (token) params.set('logintoken', token);
    const response = await this.request('/login/index.php', {
      method: 'POST',
      data: params.toString(),
      signal,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: this.baseUrl,
        Referer: `${this.baseUrl}/login/index.php`
      }
    });
    const $ = cheerio.load(response.data);
    const loginForm = $('form[action*="login/index.php"] input[name="username"]').length > 0;
    const loggedIn = $('.usermenu, .userbutton, a[href*="login/logout.php"]').length > 0;
    if (loginForm && !loggedIn) {
      const message = $('.alert-danger, #loginerrormessage, .error').first().text().trim();
      throw new Error(message || 'Đăng nhập Moodle thất bại. Vui lòng kiểm tra tài khoản và mật khẩu.');
    }
  }

  async getSesskey(signal) {
    const dashboard = await this.request('/my/', { signal });
    const $ = cheerio.load(dashboard.data);
    let sesskey = '';
    const scripts = $('script').map((_, el) => $(el).html()).get();
    for (const script of scripts) {
      if (!script) continue;
      const sk = script.match(/"sesskey":"([^"]+)"/);
      if (sk) { sesskey = sk[1]; break; }
    }
    if (!sesskey) {
      const logoutHref = $('a[href*="logout.php"]').attr('href');
      if (logoutHref) {
        const match = logoutHref.match(/sesskey=([^&]+)/);
        if (match) sesskey = match[1];
      }
    }
    return sesskey;
  }

  async getEnrolledCourses(signal) {
    const sesskey = await this.getSesskey(signal);
    if (!sesskey) throw new Error('Không thể lấy mã phiên (sesskey) từ Moodle.');

    let allCourses = [];
    let offset = 0;
    const limit = 20;

    while (true) {
      const response = await this.request(
        `/lib/ajax/service.php?sesskey=${encodeURIComponent(sesskey)}&info=core_course_get_enrolled_courses_by_timeline_classification`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          data: JSON.stringify([{
            index: 0,
            methodname: 'core_course_get_enrolled_courses_by_timeline_classification',
            args: { classification: 'all', limit, offset, sort: 'fullname' }
          }]),
          signal
        }
      );

      const data = response.data?.[0]?.data;
      if (!data || !data.courses || data.courses.length === 0) break;

      allCourses = allCourses.concat(data.courses.map(c => ({
        id: c.id,
        fullname: c.fullname,
        shortname: c.shortname,
        category: c.coursecategory || '',
        progress: c.progress !== undefined ? c.progress : null,
        hasprogress: Boolean(c.hasprogress),
        viewurl: c.viewurl,
        courseimage: c.courseimage || ''
      })));

      if (!data.nextoffset || data.nextoffset <= offset) break;
      offset = data.nextoffset;
    }
    return allCourses;
  }

  async getCourseActivities(courseId, signal) {
    const response = await this.request(`/course/view.php?id=${encodeURIComponent(courseId)}`, { signal });
    const $ = cheerio.load(response.data);
    const activities = [];
    $('a[href*="/mod/"]').each((_, element) => {
      const anchor = $(element);
      const href = anchor.attr('href') || '';
      const match = href.match(/\/mod\/([^/]+)\/view\.php\?[^#]*\bid=(\d+)/);
      if (!match) return;
      const [, type, cmid] = match;
      if (!['quiz', 'scorm', 'icontent', 'hvp', 'h5pactivity', 'resource', 'book', 'glossary', 'forum', 'chat', 'page', 'url', 'assign', 'lesson'].includes(type)) return;
      let title = anchor.find('.instancename').text().trim() || anchor.text().trim();
      title = title.replace(/\s*(iContent|SCORM package|File|URL|Quiz|Interactive Content|Book|Glossary|Forum|Chat|Page|Lesson)$/i, '').trim();
      if (!activities.some(item => item.cmid === cmid)) {
        activities.push({ cmid, type, title: title || `Hoạt động #${cmid}`, url: href });
      }
    });
    return activities;
  }

  async markActivityCompletedManually(cmid, signal) {
    try {
      const sesskey = await this.getSesskey(signal);
      if (!sesskey) return false;
      const response = await this.request(
        `/lib/ajax/service.php?sesskey=${encodeURIComponent(sesskey)}&info=core_completion_update_activity_completion_status_manually`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          data: JSON.stringify([{
            index: 0,
            methodname: 'core_completion_update_activity_completion_status_manually',
            args: { cmid: Number(cmid), completed: true }
          }]),
          signal
        }
      );
      const data = response.data?.[0]?.data;
      return Boolean(data?.status);
    } catch {
      return false;
    }
  }

  async markScormCompleted(cmid, signal) {
    try {
      const viewRes = await this.request(`/mod/scorm/view.php?id=${encodeURIComponent(cmid)}`, { signal });
      const $v = cheerio.load(viewRes.data);

      const form = $v('form[action*="player.php"]');
      const scoid = form.find('input[name="scoid"]').val() || '';
      const currentorg = form.find('input[name="currentorg"]').val() || '';

      if (!scoid) return false;

      const playerRes = await this.request('/mod/scorm/player.php', {
        method: 'POST',
        data: new URLSearchParams({ scoid, cm: String(cmid), currentorg }).toString(),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal
      });

      const $p = cheerio.load(playerRes.data);
      const scripts = $p('script').map((_, el) => $p(el).html()).get().join('\n');

      const aMatch = scripts.match(/a=(\d+)/) || scripts.match(/"scorm":"?(\d+)"?/);
      const scormid = aMatch ? aMatch[1] : '';
      if (!scormid) return false;

      const attemptMatch = scripts.match(/attempt=(\d+)/);
      const currentAttempt = attemptMatch ? attemptMatch[1] : '1';

      const sesskey = await this.getSesskey(signal);
      if (!sesskey) return false;

      const numericScoid = Number(scoid);
      const targetScoids = Array.from(new Set([numericScoid, numericScoid - 1, numericScoid + 1].filter(s => s > 0)));
      const attemptsToTry = Array.from(new Set(['1', String(currentAttempt)]));

      let success = false;

      for (const s of targetScoids) {
        for (const att of attemptsToTry) {
          const dmParams = new URLSearchParams({
            id: String(cmid),
            a: String(scormid),
            scoid: String(s),
            attempt: att,
            mode: 'normal',
            sesskey,
            // SCORM 1.2
            cmi_core_lesson_status: 'passed',
            cmi_core_score_raw: '100',
            cmi_core_score_min: '0',
            cmi_core_score_max: '100',
            cmi_core_session_time: '00:05:00',
            cmi_core_total_time: '00:05:00',
            cmi_core_lesson_location: '1',
            cmi_core_exit: 'suspend',
            'cmi.core.lesson_status': 'passed',
            'cmi.core.score.raw': '100',
            'cmi.core.score.min': '0',
            'cmi.core.score.max': '100',
            // SCORM 2004
            cmi_completion_status: 'completed',
            cmi_success_status: 'passed',
            cmi_score_raw: '100',
            cmi_score_min: '0',
            cmi_score_max: '100',
            cmi_score_scaled: '1.0',
            cmi_progress_measure: '1.0',
            cmi_session_time: 'PT5M',
            cmi_total_time: 'PT5M',
            cmi_exit: 'suspend',
            cmi_location: '1',
            'cmi.completion_status': 'completed',
            'cmi.success_status': 'passed',
            'cmi.score.raw': '100',
            'cmi.score.scaled': '1.0'
          });

          const dmRes = await this.request('/mod/scorm/datamodel.php', {
            method: 'POST',
            data: dmParams.toString(),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            signal
          });

          if (String(dmRes.data).includes('true')) {
            success = true;
          }

          // Trigger prereqs update
          try {
            await this.request(
              `/mod/scorm/prereqs.php?a=${scormid}&scoid=${s}&attempt=${att}&mode=normal&currentorg=${encodeURIComponent(currentorg)}&sesskey=${sesskey}`,
              { signal }
            );
          } catch {}
        }
      }

      // Force view refresh to sync Moodle database completion state
      try {
        await this.request(`/mod/scorm/view.php?id=${encodeURIComponent(cmid)}&forceview=1`, { signal });
      } catch {}

      return success;
    } catch {
      return false;
    }
  }

  async visitActivity(type, cmid, signal) {
    const url = `/mod/${encodeURIComponent(type)}/view.php?id=${encodeURIComponent(cmid)}`;
    const response = await this.request(url, { signal });
    const $ = cheerio.load(response.data);

    let hvpScoreSent = false;
    let manualCompleted = false;

    // If it's a SCORM module, execute SCORM completion API flow
    if (type === 'scorm') {
      try {
        const scormOk = await this.markScormCompleted(cmid, signal);
        if (scormOk) hvpScoreSent = true;
      } catch {}
    }

    // If it's an HVP / H5P module or contains H5PIntegration, send setFinished AJAX
    const scripts = $('script').map((_, el) => $(el).html()).get();
    for (const script of scripts) {
      if (!script) continue;
      const match = script.match(/var H5PIntegration\s*=\s*(\{[\s\S]*?\});/);
      if (match) {
        try {
          const parsed = JSON.parse(match[1]);
          const setFinishedUrl = parsed.ajax?.setFinished;
          const cidKey = Object.keys(parsed.contents || {})[0];
          const contentId = cidKey ? cidKey.replace('cid-', '') : null;
          if (setFinishedUrl && contentId) {
            const params = new URLSearchParams({
              contentId,
              score: '100',
              maxScore: '100',
              opened: Math.floor(Date.now() / 1000 - 10).toString(),
              finished: Math.floor(Date.now() / 1000).toString(),
              time: '10'
            });
            await this.request(setFinishedUrl, {
              method: 'POST',
              data: params.toString(),
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              signal
            });
            hvpScoreSent = true;
          }
        } catch {}
        break;
      }
    }

    // Trigger Moodle manual completion toggle ("Mark as done")
    const manualRes = await this.markActivityCompletedManually(cmid, signal);
    if (manualRes) manualCompleted = true;

    // Fallback: If there is a manual completion toggle form on the page, also post to it
    const toggleAction = $('form[action*="togglecompletion"]').attr('action');
    if (toggleAction) {
      try {
        const formData = new URLSearchParams();
        $('form[action*="togglecompletion"] input[type="hidden"]').each((_, el) => {
          const name = $(el).attr('name');
          if (name) formData.set(name, $(el).val() || '');
        });
        await this.request(toggleAction, {
          method: 'POST',
          data: formData.toString(),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          signal
        });
        manualCompleted = true;
      } catch {}
    }

    return {
      hvpScoreSent,
      manualCompleted,
      title: $('h1, .page-header-headings').first().text().trim(),
      html: response.data
    };
  }

  async getQuizDetails(cmid, signal) {
    const response = await this.request(`/mod/quiz/view.php?id=${encodeURIComponent(cmid)}`, { signal });
    const $ = cheerio.load(response.data);
    let inProgressAttemptId = null;
    $('a[href*="attempt.php?attempt="]').each((_, link) => {
      const match = ($(link).attr('href') || '').match(/attempt=(\d+)/);
      if (match) inProgressAttemptId = match[1];
    });
    return {
      title: $('.page-header-headings h1, .breadcrumb-item.active').first().text().trim() || `Quiz #${cmid}`,
      sesskey: $('input[name="sesskey"]').val() || '',
      inProgressAttemptId,
      canStart: Boolean(inProgressAttemptId) || $('form[action*="startattempt.php"], a[href*="startattempt.php"]').length > 0
    };
  }

  async startOrResumeAttempt(cmid, details, signal) {
    if (details.inProgressAttemptId) {
      const response = await this.request(`/mod/quiz/attempt.php?attempt=${details.inProgressAttemptId}`, { signal });
      return { attemptId: details.inProgressAttemptId, html: response.data, resumed: true };
    }
    const params = new URLSearchParams({ cmid: String(cmid), sesskey: details.sesskey });
    const response = await this.request('/mod/quiz/startattempt.php', {
      method: 'POST', data: params.toString(), signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    let attemptId = cheerio.load(response.data)('input[name="attempt"]').val();
    if (!attemptId && response.request?.res?.responseUrl) {
      const match = response.request.res.responseUrl.match(/attempt=(\d+)/);
      if (match) attemptId = match[1];
    }
    if (!attemptId && typeof response.data === 'string') {
      const match = response.data.match(/attempt\.php\?attempt=(\d+)/) || response.data.match(/name="attempt"\s+value="(\d+)"/);
      if (match) attemptId = match[1];
    }
    if (!attemptId) throw new Error('Không tìm thấy mã lượt làm bài sau khi khởi tạo.');
    return { attemptId: String(attemptId), html: response.data, resumed: false };
  }

  parseAttemptPage(html) {
    const $ = cheerio.load(html);
    const questions = [];
    const formInputs = {};
    $('#responseform input[type="hidden"], form[action*="processattempt"] input[type="hidden"]').each((_, input) => {
      const name = $(input).attr('name');
      if (name) formInputs[name] = $(input).val() || '';
    });
    $('.que').each((index, element) => {
      const block = $(element);
      const hiddenInputs = {};
      block.find('input[type="hidden"]').each((_, input) => {
        const name = $(input).attr('name');
        if (name) hiddenInputs[name] = $(input).val() || '';
      });
      let type = 'unknown';
      if (block.hasClass('multichoice')) type = 'multichoice';
      else if (block.hasClass('truefalse')) type = 'truefalse';
      else if (block.hasClass('shortanswer')) type = 'shortanswer';
      else if (block.hasClass('match')) type = 'match';
      const options = [];
      block.find('.answer input[type="radio"], .answer input[type="checkbox"]').each((_, input) => {
        const field = $(input);
        const text = field.closest('label, div, tr').text().replace(/^[a-zA-Z0-9][.)]\s*/, '').trim();
        options.push({ name: field.attr('name'), value: field.attr('value'), text, inputType: field.attr('type') });
      });
      block.find('input[type="text"]').each((_, input) => {
        const field = $(input);
        options.push({ name: field.attr('name'), value: '', text: 'Text Input', inputType: 'text' });
      });
      block.find('select').each((_, selectEl) => {
        const select = $(selectEl);
        const name = select.attr('name');
        if (!name) return;
        const selectOptions = [];
        select.find('option').each((_, opt) => {
          const val = $(opt).attr('value');
          const text = $(opt).text().trim();
          if (val && val !== '' && val !== '0') selectOptions.push({ value: val, text });
        });
        options.push({ name, value: '', text: 'Select Input', inputType: 'select', selectOptions });
      });
      questions.push({
        id: block.attr('id') || `question-${index + 1}`,
        index: index + 1,
        type,
        text: block.find('.qtext').text().trim(),
        options: options.filter(option => option.name),
        hiddenInputs
      });
    });
    const nextButton = $('.mod_quiz-next-nav');
    return {
      sesskey: $('input[name="sesskey"]').val() || '',
      formInputs,
      questions,
      isLastPage: $('input[name="finishattempt"]').length > 0 || /finish attempt|kết thúc/i.test(nextButton.val() || nextButton.text())
    };
  }

  async submitPageAnswers(attemptId, sesskey, formData, signal) {
    const params = new URLSearchParams();
    Object.entries(formData).forEach(([key, value]) => params.set(key, value ?? ''));
    params.set('attempt', String(attemptId));
    params.set('sesskey', sesskey);
    params.set('next', 'Next page');
    const response = await this.request('/mod/quiz/processattempt.php', {
      method: 'POST', data: params.toString(), signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    return response.data;
  }

  async finishAttempt(attemptId, sesskey, signal) {
    const params = new URLSearchParams({ attempt: String(attemptId), finishattempt: '1', timeup: '0', sesskey });
    await this.request('/mod/quiz/processattempt.php', {
      method: 'POST', data: params.toString(), signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
  }

  async getReviewPage(attemptId, signal) {
    const response = await this.request(`/mod/quiz/review.php?attempt=${encodeURIComponent(attemptId)}&showall=1`, { signal });
    return response.data;
  }
}
