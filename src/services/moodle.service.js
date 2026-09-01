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
      if (!['quiz', 'scorm', 'icontent'].includes(type)) return;
      let title = anchor.find('.instancename').text().trim() || anchor.text().trim();
      title = title.replace(/\s*(iContent|SCORM package|File|URL|Quiz)$/i, '').trim();
      if (title && !activities.some(item => item.cmid === cmid)) {
        activities.push({ cmid, type, title, url: href });
      }
    });
    return activities;
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
    const attemptId = cheerio.load(response.data)('input[name="attempt"]').val();
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
