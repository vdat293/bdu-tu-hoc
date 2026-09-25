import axios from 'axios';
import * as cheerio from 'cheerio';
import { CookieJar } from 'tough-cookie';

const MOODLE_URL = 'https://bdu.vn247.org';

export function sanitizeMoodleUrl(value) {
  const raw = String(value || '');
  try {
    const parsed = new URL(raw, MOODLE_URL);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return raw.split(/[?#]/, 1)[0] || MOODLE_URL;
  }
}

function safeMoodleErrorCode(value) {
  const candidate = value && typeof value === 'object'
    ? (value.errorcode || value.code || value.exception)
    : value;
  const normalized = String(candidate || '').trim();
  return /^[a-z0-9_.:-]{1,80}$/i.test(normalized) ? normalized : 'moodle_error';
}

function extractSesskey($) {
  const inputSesskey = $('input[name="sesskey"]').first().val();
  if (inputSesskey) return String(inputSesskey);

  const metaSesskey = $('meta[name="sesskey"]').attr('content');
  if (metaSesskey) return String(metaSesskey);

  const scripts = $('script').map((_, el) => $(el).html()).get();
  for (const script of scripts) {
    if (!script) continue;
    const match = script.match(/["']sesskey["']\s*:\s*["']([^"']+)["']/)
      || script.match(/\bsesskey\s*=\s*["']([^"']+)["']/);
    if (match) return match[1];
  }

  return '';
}

/** Cookie-isolated Moodle client adapted from tool-do-eng-web/lib/moodle.js. */
export class MoodleClient {
  constructor() {
    this.baseUrl = MOODLE_URL;
    this.jar = new CookieJar();
    this.lastManualCompletionFailure = '';
    this.lastCourseContentsFailure = '';
    this.lastCourseContentsSesskey = '';
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
      const safeUrl = sanitizeMoodleUrl(url);
      if (err.response) {
        if (err.response.status === 404) {
          throw new Error(`Tài nguyên không tồn tại trên Moodle (HTTP 404: ${safeUrl}).`);
        }
        if (err.response.status === 403) {
          throw new Error(`Moodle từ chối truy cập (HTTP 403: ${safeUrl}).`);
        }
        throw new Error(`Lỗi phản hồi từ Moodle (HTTP ${err.response.status}) tại ${safeUrl}.`);
      }
      // Axios/network errors can echo the complete upstream URL, including
      // sesskey or other Moodle query credentials. Do not propagate them.
      throw new Error(`Không thể kết nối tới Moodle (${safeUrl}).`);
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
      // Moodle error HTML is untrusted and may echo query/session values.
      throw new Error('Đăng nhập Moodle thất bại. Vui lòng kiểm tra tài khoản và mật khẩu.');
    }
  }

  async getSesskey(signal) {
    const dashboard = await this.request('/my/', { signal });
    const $ = cheerio.load(dashboard.data);
    let sesskey = extractSesskey($);
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

  async getCourseContents(courseId, signal) {
    this.lastCourseContentsFailure = '';
    this.lastCourseContentsSesskey = '';
    try {
      const numericCourseId = Number(courseId);
      if (!Number.isInteger(numericCourseId) || numericCourseId <= 0) {
        this.lastCourseContentsFailure = `courseid không hợp lệ: ${courseId}`;
        return [];
      }
      const sesskey = await this.getSesskey(signal);
      if (!sesskey) {
        this.lastCourseContentsFailure = 'không lấy được sesskey cho core_courseformat_get_state';
        return [];
      }
      this.lastCourseContentsSesskey = sesskey;
      const response = await this.request(
        `/lib/ajax/service.php?sesskey=${encodeURIComponent(sesskey)}&info=core_courseformat_get_state`,
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
          },
          data: JSON.stringify([{
            index: 0,
            methodname: 'core_courseformat_get_state',
            args: { courseid: numericCourseId }
          }]),
          signal
        }
      );
      const result = response.data?.[0];
      if (result?.error || result?.exception || !result?.data) {
        const failure = result?.exception || result?.error || result?.data || 'Moodle không trả course state';
        this.lastCourseContentsFailure = `Moodle trả lỗi API: ${safeMoodleErrorCode(failure)}`;
        return [];
      }
      if (typeof result.data === 'string') {
        try {
          return JSON.parse(result.data);
        } catch (error) {
          this.lastCourseContentsFailure = `Moodle course state không phải JSON (${safeMoodleErrorCode(error)}).`;
          return [];
        }
      }
      return result.data;
    } catch (error) {
      this.lastCourseContentsFailure = `Moodle không lấy được course contents (${safeMoodleErrorCode(error)}).`;
      return [];
    }
  }

  collectManualOnlyContents(sections) {
    const manualOnly = [];
    const visit = entries => {
      for (const entry of entries || []) {
        const modules = Array.isArray(entry.modules) ? entry.modules : [];
        for (const module of modules) {
          const completion = module.completiondata || {};
          const hasManualCompletion = Number(module.completion) === 1
            || (completion.hascompletion === true && completion.isautomatic === false);
          const isIncomplete = Number(completion.state) === 0;
          const hasNoActivityUrl = !String(module.url || '').trim();
          if (hasManualCompletion && isIncomplete && hasNoActivityUrl && module.id) {
            manualOnly.push({
              cmid: String(module.id),
              type: 'manual',
              title: String(module.name || `Hoạt động #${module.id}`).trim(),
              url: null
            });
          }
        }
        visit(entry.contents);
      }
    };
    if (Array.isArray(sections)) {
      visit(sections);
    }
    return manualOnly;
  }

  async findManualOnlyContents(state, signal) {
    const modules = Array.isArray(state?.cm)
      ? state.cm
      : (Array.isArray(state?.cms) ? state.cms : []);
    const candidates = modules.filter(module => module?.id && !String(module.url || '').trim());
    if (!candidates.length) return [];

    const sesskey = this.lastCourseContentsSesskey || await this.getSesskey(signal);
    if (!sesskey) return [];
    const manualOnly = [];

    for (const module of candidates) {
      try {
        const response = await this.request(
          `/lib/ajax/service.php?sesskey=${encodeURIComponent(sesskey)}&info=core_course_get_module`,
          {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              'X-Requested-With': 'XMLHttpRequest'
            },
            data: JSON.stringify([{
              index: 0,
              methodname: 'core_course_get_module',
              args: { id: Number(module.id), sectionreturn: 0 }
            }]),
            signal
          }
        );
        const result = response.data?.[0];
        if (result?.error || result?.exception || typeof result?.data !== 'string') continue;
        const $module = cheerio.load(result.data);
        const button = $module('[data-action="toggle-manual-completion"][data-toggletype="manual:mark-done"][data-cmid]').first();
        if (!button.length || String(button.attr('data-cmid')) !== String(module.id)) continue;
        manualOnly.push({
          cmid: String(module.id),
          type: 'manual',
          title: String(button.attr('data-activityname') || module.name || `Hoạt động #${module.id}`).trim(),
          url: null
        });
      } catch {}
    }
    return manualOnly;
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

    // Moodle can render a manual-completion activity (notably iContent's
    // parent label) as a button without an /mod/.../view.php link. Keep these
    // controls in the automation queue so the runner performs the same
    // completion action as the browser's "Mark as done" button.
    $('[data-action="toggle-manual-completion"][data-toggletype="manual:mark-done"][data-cmid]').each((_, element) => {
      const button = $(element);
      const cmid = button.attr('data-cmid') || '';
      if (!cmid || activities.some(item => item.cmid === cmid)) return;
      const module = button.closest('[id^="module-"]');
      const title = button.attr('data-activityname')
        || module.find('.activity-content, [id$="-title"]').first().text().trim()
        || `Hoạt động #${cmid}`;
      activities.push({ cmid, type: 'manual', title, url: null });
    });

    // Moodle's course page can add completion buttons after the initial HTML
    // through JS. The AJAX contents response is the authoritative fallback
    // for manual-only modules that have no activity URL (notably label).
    const contents = await this.getCourseContents(courseId, signal);
    const manualOnly = Array.isArray(contents)
      ? this.collectManualOnlyContents(contents)
      : await this.findManualOnlyContents(contents, signal);
    for (const activity of manualOnly) {
      if (!activities.some(item => item.cmid === activity.cmid)) activities.push(activity);
    }

    return activities;
  }

  async markActivityCompletedManually(cmid, signal, sesskey = '') {
    this.lastManualCompletionFailure = '';
    try {
      const numericCmid = Number(cmid);
      if (!Number.isInteger(numericCmid) || numericCmid <= 0) {
        this.lastManualCompletionFailure = `cmid không hợp lệ: ${cmid}`;
        return false;
      }
      const resolvedSesskey = sesskey || await this.getSesskey(signal);
      if (!resolvedSesskey) {
        this.lastManualCompletionFailure = 'không lấy được sesskey';
        return false;
      }
      const response = await this.request(
        `/lib/ajax/service.php?sesskey=${encodeURIComponent(resolvedSesskey)}&info=core_completion_update_activity_completion_status_manually`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          data: JSON.stringify([{
            index: 0,
            methodname: 'core_completion_update_activity_completion_status_manually',
            args: { cmid: numericCmid, completed: true }
          }]),
          signal
        }
      );
      const result = response.data?.[0];
      if (result?.error || result?.exception || result?.data?.error) {
        const failure = result.errorcode || result.exception || result.data.error || 'Moodle trả lỗi API';
        this.lastManualCompletionFailure = `Moodle trả lỗi API: ${safeMoodleErrorCode(failure)}`;
        return false;
      }
      if (result?.data?.status !== true) {
        this.lastManualCompletionFailure = `Moodle trả status không hợp lệ (${safeMoodleErrorCode(result?.data?.status)}).`;
        return false;
      }
      return true;
    } catch (error) {
      this.lastManualCompletionFailure = `Moodle completion request thất bại (${safeMoodleErrorCode(error)}).`;
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

      const attMatch = scripts.match(/"\d+",\s*"(\d+)",\s*"normal"/) || scripts.match(/attempt=(\d+)/);
      const currentAttempt = attMatch ? attMatch[1] : '1';

      const sMatch = scripts.match(/"([a-zA-Z0-9]{10})",\s*"\d+"/);
      const sesskey = sMatch ? sMatch[1] : await this.getSesskey(signal);
      if (!sesskey) return false;

      const scoMatches = scripts.match(/"(\d+)":\{"cmi\./g);
      const allScoids = Array.from(new Set([
        scoid,
        ...(scoMatches ? scoMatches.map(m => m.match(/\d+/)[0]) : []),
        String(Number(scoid) - 1),
        String(Number(scoid) + 1)
      ].filter(s => Number(s) > 0)));

      const attemptsToTry = Array.from(new Set(['1', String(currentAttempt)]));
      let success = false;

      for (const s of allScoids) {
        for (const att of attemptsToTry) {
          const dmParams = new URLSearchParams({
            id: String(cmid),
            a: String(scormid),
            scoid: String(s),
            attempt: att,
            mode: 'normal',
            sesskey,

            // SCORM 2004 with Moodle double-underscore notation (critical for PHP parsing)
            cmi__completion_status: 'completed',
            cmi__success_status: 'passed',
            cmi__score__raw: '100',
            cmi__score__min: '0',
            cmi__score__max: '100',
            cmi__score__scaled: '1',
            cmi__session_time: 'PT0H5M0S',
            cmi__total_time: 'PT5M',
            cmi__exit: 'normal',

            // SCORM 1.2 with Moodle double-underscore notation
            cmi__core__lesson_status: 'passed',
            cmi__core__score__raw: '100',
            cmi__core__score__min: '0',
            cmi__core__score__max: '100',
            cmi__core__session_time: '00:05:00',
            cmi__core__total_time: '00:05:00',
            cmi__core__exit: 'normal',

            // Fallback flat and dot notations
            cmi_completion_status: 'completed',
            cmi_success_status: 'passed',
            cmi_score_raw: '100',
            cmi_score_min: '0',
            cmi_score_max: '100',
            cmi_score_scaled: '1.0',
            cmi_session_time: 'PT5M',
            cmi_total_time: 'PT5M',
            cmi_exit: 'normal',
            cmi_core_lesson_status: 'passed',
            cmi_core_score_raw: '100',
            cmi_core_score_min: '0',
            cmi_core_score_max: '100',
            cmi_core_session_time: '00:05:00',
            cmi_core_total_time: '00:05:00',
            cmi_core_exit: 'normal',
            'cmi.completion_status': 'completed',
            'cmi.success_status': 'passed',
            'cmi.score.raw': '100',
            'cmi.score.scaled': '1.0',
            'cmi.core.lesson_status': 'passed',
            'cmi.core.score.raw': '100'
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

          // Trigger prereqs update to evaluate tracks and persist grade
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
    if (type === 'manual') {
      const manualCompleted = await this.markActivityCompletedManually(cmid, signal);
      if (!manualCompleted) {
        throw new Error(`Moodle không ghi nhận Mark as done cho hoạt động #${cmid}: ${this.lastManualCompletionFailure || 'API không trả status=true'}.`);
      }
      return {
        scormCompleted: false,
        hvpScoreSent: false,
        manualCompleted,
        title: `Hoạt động #${cmid}`,
        html: ''
      };
    }

    const url = `/mod/${encodeURIComponent(type)}/view.php?id=${encodeURIComponent(cmid)}`;
    const response = await this.request(url, { signal });
    const $ = cheerio.load(response.data);

    let hvpScoreSent = false;
    let scormCompleted = false;
    let manualCompleted = false;

    // If it's a SCORM module, execute SCORM completion API flow
    if (type === 'scorm') {
      try {
        const scormOk = await this.markScormCompleted(cmid, signal);
        if (scormOk) {
          scormCompleted = true;
          hvpScoreSent = true;
        }
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

    // Trigger Moodle manual completion toggle ("Mark as done"). Modern
    // Moodle/iContent renders this as a data-action button, not a form.
    const manualButton = $('[data-action="toggle-manual-completion"][data-toggletype="manual:mark-done"][data-cmid]').first();
    const buttonCmid = manualButton.attr('data-cmid') || '';
    if (buttonCmid && String(buttonCmid) !== String(cmid)) {
      throw new Error(`Moodle trả về cmid không khớp cho hoạt động #${cmid}.`);
    }
    const pageSesskey = extractSesskey($);
    const manualRes = await this.markActivityCompletedManually(buttonCmid || cmid, signal, pageSesskey);
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

    if ((manualButton.length > 0 || toggleAction) && !manualCompleted) {
      throw new Error(`Moodle không ghi nhận Mark as done cho hoạt động #${cmid}: ${this.lastManualCompletionFailure || 'API không trả status=true'}.`);
    }

    return {
      scormCompleted,
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
