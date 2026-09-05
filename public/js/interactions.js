/**
 * BDU Student Hub — Progressive Frontend Showcase
 * Every enhancement is optional and capability-gated.
 */

(() => {
  'use strict';

  const SELECTORS = {
    reveal: '.glass-panel, .stat-card, .schedule-card, .doc-card, .video-card, .learning-section-block',
    tilt: '.chart-card, .profile-hero-card, .sub-bento-card, .schedule-card, .doc-card, .video-card, .wordfmt-card, .survey-card, .english-card, .english-bank',
    ripple: '.btn, .nav-item, .topbar-btn, .btn-icon, .btn-action-sm, .btn-advisor-action'
  };

  class ShowcaseUI {
    constructor() {
      this.reduceMotion = window.BDUMotion?.effectiveMode === 'reduced'
        || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
      this.commandIndex = -1;
      this.revealObserver = null;
      this.sidebarObserver = null;
      this.mutationObserver = null;
      this.commands = [];
      this.dashboardEnhancementsReady = false;
    }

    init() {
      document.documentElement.classList.add('showcase-ready');
      window.addEventListener('bdu:motionchange', () => {
        this.reduceMotion = window.BDUMotion?.effectiveMode === 'reduced'
          || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      });
      this.setupPointerSpotlight();
      const activateDashboardEnhancements = () => {
        if (this.dashboardEnhancementsReady || document.getElementById('dashboard-view')?.classList.contains('hidden')) return;
        this.dashboardEnhancementsReady = true;
        this.setupParallaxEnvironment();
        this.setupCommandPalette();
        this.setupRevealChoreography();
        this.setupTiltCards(document.getElementById('dashboard-view') || document);
        this.setupRipples(document.getElementById('dashboard-view') || document);
        this.setupStatAnimations();
        this.setupMobileSidebar();
        this.setupNetworkBeacon();
        this.setupScrollProgress();
        this.setupRovingNavigation();
        this.setupDynamicEnhancement();
        this.enhanceCourseRows(document.getElementById('dashboard-view') || document);
      };
      window.addEventListener('bdu:dashboard-ready', activateDashboardEnhancements, { once: true });
      activateDashboardEnhancements();
    }

    setupPointerSpotlight() {
      if (!this.finePointer || this.reduceMotion) return;
      document.body.classList.add('has-fine-pointer');
      let frame = 0;
      window.addEventListener('pointermove', (event) => {
        if (document.hidden || window.BDUMotion?.effectiveMode === 'reduced') return;
        if (frame) return;
        frame = requestAnimationFrame(() => {
          document.body.style.setProperty('--pointer-x', `${event.clientX}px`);
          document.body.style.setProperty('--pointer-y', `${event.clientY}px`);
          frame = 0;
        });
      }, { passive: true });
    }

    setupParallaxEnvironment() {
      const dashboard = document.getElementById('dashboard-view');
      if (!dashboard) return;

      const environment = document.createElement('div');
      environment.className = 'parallax-environment';
      environment.setAttribute('aria-hidden', 'true');
      environment.innerHTML = `
        <div class="parallax-layer parallax-grid" data-depth="8" data-scroll-depth="-0.025"></div>
        <div class="parallax-layer parallax-orb parallax-orb-one" data-depth="22" data-scroll-depth="-0.08"></div>
        <div class="parallax-layer parallax-orb parallax-orb-two" data-depth="-16" data-scroll-depth="-0.045"></div>
        <div class="parallax-layer parallax-type" data-depth="-9" data-scroll-depth="-0.13">
          <img src="assets/images/logo-bdu-eng-1024.webp" alt="" width="1024" height="578" loading="lazy" decoding="async">
        </div>
        <div class="parallax-layer parallax-rule" data-depth="14" data-scroll-depth="-0.18"></div>`;
      if (!dashboard.querySelector('.parallax-environment')) dashboard.prepend(environment);

      document.querySelectorAll('.tab-pane').forEach((pane, index) => {
        const sectionIndex = String(index + 1).padStart(2, '0');
        pane.dataset.sectionIndex = sectionIndex;
        pane.querySelector('.section-header-box')?.setAttribute('data-section-index', sectionIndex);
      });

      if (this.reduceMotion) return;
      const layers = [...environment.querySelectorAll('.parallax-layer')];
      const scroller = document.querySelector('.dashboard-body');
      let pointerX = 0;
      let pointerY = 0;
      let scrollY = 0;
      let frame = 0;

      const render = () => {
        if (document.hidden || window.BDUMotion?.effectiveMode === 'reduced') {
          frame = 0;
          return;
        }
        layers.forEach(layer => {
          const depth = Number(layer.dataset.depth || 0);
          const scrollDepth = Number(layer.dataset.scrollDepth || 0);
          const x = pointerX * depth;
          const y = pointerY * depth + scrollY * scrollDepth;
          layer.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
        });
        document.documentElement.style.setProperty('--section-parallax', `${(scrollY * -.035).toFixed(2)}px`);
        frame = 0;
      };

      const requestRender = () => {
        if (document.hidden || window.BDUMotion?.effectiveMode === 'reduced') return;
        if (!frame) frame = requestAnimationFrame(render);
      };

      window.addEventListener('pointermove', event => {
        if (document.hidden || window.BDUMotion?.effectiveMode === 'reduced') return;
        pointerX = event.clientX / window.innerWidth - .5;
        pointerY = event.clientY / window.innerHeight - .5;
        requestRender();
      }, { passive: true });
      scroller?.addEventListener('scroll', () => {
        scrollY = scroller.scrollTop;
        requestRender();
      }, { passive: true });
      window.addEventListener('scroll', () => {
        scrollY = window.scrollY;
        requestRender();
      }, { passive: true });
      render();
      window.addEventListener('bdu:motionchange', () => {
        if (window.BDUMotion?.effectiveMode === 'reduced') layers.forEach(layer => { layer.style.transform = ''; });
        else requestRender();
      });
    }

    setupCommandPalette() {
      const topbarActions = document.querySelector('.topbar-actions');
      if (!topbarActions) return;

      const commandKeywords = {
        'tab-grades': 'điểm gpa kết quả học tập',
        'tab-profile': 'hồ sơ sinh viên thông tin cá nhân lý lịch',
        'tab-schedule': 'lịch học thời khóa biểu',
        'tab-leaderboard': 'bảng xếp hạng thứ hạng top lớp khoa viện trường khóa',
        'tab-wordfmt': 'word docx văn bản định dạng',
        'tab-survey': 'khảo sát đánh giá giảng viên',
        'tab-english': 'tiếng anh english moodle quiz bài tập tự động',
        'tab-enrollment': 'đăng ký môn tín chỉ học phần',
        'tab-learning': 'tài liệu video học liệu bài giảng'
      };
      const navCommands = [...document.querySelectorAll('.nav-item[data-tab]')].map((item, index) => ({
        id: item.dataset.tab,
        label: item.querySelector('.nav-text')?.textContent.trim() || `Mục ${index + 1}`,
        hint: String(index + 1).padStart(2, '0'),
        group: 'Điều hướng',
        keywords: commandKeywords[item.dataset.tab] || '',
        run: () => item.click()
      }));

      this.commands = [
        ...navCommands,
        {
          id: 'theme', label: 'Chuyển giao diện sáng / tối', hint: 'T', group: 'Thao tác',
          run: () => document.getElementById('btn-theme-toggle')?.click()
        },
        {
          id: 'refresh', label: 'Làm mới dữ liệu học vụ', hint: 'R', group: 'Thao tác',
          run: () => document.getElementById('btn-refresh')?.click()
        }
      ];

      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'command-trigger';
      trigger.setAttribute('aria-label', 'Mở bảng lệnh');
      trigger.innerHTML = '<span>Tìm nhanh</span><kbd>⌘K</kbd>';
      topbarActions.prepend(trigger);

      const palette = document.createElement('div');
      palette.className = 'command-palette';
      palette.setAttribute('aria-hidden', 'true');
      palette.innerHTML = `
        <section class="command-panel" role="dialog" aria-modal="true" aria-label="Bảng lệnh nhanh">
          <div class="command-search-wrap">
            <span class="command-search-index">/</span>
            <input class="command-search" type="search" autocomplete="off" placeholder="Tìm trang hoặc thao tác…" aria-label="Tìm lệnh">
            <kbd>ESC</kbd>
          </div>
          <div class="command-results" role="listbox"></div>
          <div class="command-footer"><span>↑ ↓ để di chuyển · Enter để chọn</span><span>BDU Command Center</span></div>
        </section>`;
      document.body.appendChild(palette);

      this.palette = palette;
      this.commandInput = palette.querySelector('.command-search');
      this.commandResults = palette.querySelector('.command-results');
      this.renderCommands('');

      trigger.addEventListener('click', () => this.openPalette());
      palette.addEventListener('click', (event) => {
        if (event.target === palette) this.closePalette();
      });
      this.commandInput.addEventListener('input', () => this.renderCommands(this.commandInput.value));
      this.commandInput.addEventListener('keydown', (event) => this.handleCommandKeys(event));

      document.addEventListener('keydown', (event) => {
        const isCommandK = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
        if (isCommandK) {
          event.preventDefault();
          this.palette.classList.contains('is-open') ? this.closePalette() : this.openPalette();
        }
        if (event.key === 'Escape' && this.palette.classList.contains('is-open')) this.closePalette();
      });
    }

    normalize(value) {
      return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    }

    getFilteredCommands(query) {
      const normalized = this.normalize(query.trim());
      if (!normalized) return this.commands;
      return this.commands.filter(command => this.normalize(`${command.label} ${command.group} ${command.keywords || ''}`).includes(normalized));
    }

    renderCommands(query) {
      const filtered = this.getFilteredCommands(query);
      this.filteredCommands = filtered;
      this.commandIndex = filtered.length ? 0 : -1;
      if (!filtered.length) {
        this.commandResults.innerHTML = '<div class="command-empty">Không tìm thấy thao tác phù hợp.</div>';
        return;
      }

      let previousGroup = '';
      this.commandResults.innerHTML = filtered.map((command, index) => {
        const group = command.group !== previousGroup
          ? `<div class="command-group-label">${command.group}</div>`
          : '';
        previousGroup = command.group;
        return `${group}<button class="command-item ${index === 0 ? 'is-selected' : ''}" role="option" aria-selected="${index === 0}" data-command-index="${index}"><span class="command-number">${command.hint}</span><span>${command.label}</span></button>`;
      }).join('');

      this.commandResults.querySelectorAll('.command-item').forEach(item => {
        item.addEventListener('mouseenter', () => this.selectCommand(Number(item.dataset.commandIndex)));
        item.addEventListener('click', () => this.runCommand(Number(item.dataset.commandIndex)));
      });
    }

    openPalette() {
      if (document.getElementById('dashboard-view')?.classList.contains('hidden')) return;
      this.palette.classList.add('is-open');
      this.palette.setAttribute('aria-hidden', 'false');
      document.documentElement.style.overflow = 'hidden';
      this.commandInput.value = '';
      this.renderCommands('');
      requestAnimationFrame(() => this.commandInput.focus());
    }

    closePalette() {
      this.palette.classList.remove('is-open');
      this.palette.setAttribute('aria-hidden', 'true');
      document.documentElement.style.overflow = '';
    }

    handleCommandKeys(event) {
      if (!this.filteredCommands?.length) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.selectCommand((this.commandIndex + 1) % this.filteredCommands.length);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        this.selectCommand((this.commandIndex - 1 + this.filteredCommands.length) % this.filteredCommands.length);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        this.runCommand(this.commandIndex);
      }
    }

    selectCommand(index) {
      this.commandIndex = index;
      this.commandResults.querySelectorAll('.command-item').forEach((item, itemIndex) => {
        const selected = itemIndex === index;
        item.classList.toggle('is-selected', selected);
        item.setAttribute('aria-selected', String(selected));
        if (selected) item.scrollIntoView({ block: 'nearest' });
      });
    }

    runCommand(index) {
      const command = this.filteredCommands?.[index];
      if (!command) return;
      this.closePalette();
      command.run();
    }

    setupRevealChoreography() {
      if (this.reduceMotion || !('IntersectionObserver' in window)) return;
      this.revealObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-revealed');
          this.revealObserver.unobserve(entry.target);
        });
      }, { threshold: .08, rootMargin: '0px 0px -40px' });
      this.observeRevealElements(document);
    }

    observeRevealElements(root) {
      if (!this.revealObserver) return;
      root.querySelectorAll?.(SELECTORS.reveal).forEach((element, index) => {
        if (element.classList.contains('reveal-ready')) return;
        element.classList.add('reveal-ready');
        element.style.setProperty('--reveal-delay', `${Math.min(index % 5, 4) * 45}ms`);
        this.revealObserver.observe(element);
      });
    }

    setupTiltCards(root) {
      if (!this.finePointer || this.reduceMotion) return;
      root.querySelectorAll?.(SELECTORS.tilt).forEach(card => {
        if (card.dataset.tiltReady) return;
        card.dataset.tiltReady = 'true';
        card.classList.add('showcase-tilt');
        card.addEventListener('pointermove', event => {
          if (document.hidden || window.BDUMotion?.effectiveMode === 'reduced') return;
          const bounds = card.getBoundingClientRect();
          const x = (event.clientX - bounds.left) / bounds.width - .5;
          const y = (event.clientY - bounds.top) / bounds.height - .5;
          card.style.setProperty('--tilt-x', `${(-y * 2.4).toFixed(2)}deg`);
          card.style.setProperty('--tilt-y', `${(x * 2.8).toFixed(2)}deg`);
        }, { passive: true });
        card.addEventListener('pointerleave', () => {
          card.style.setProperty('--tilt-x', '0deg');
          card.style.setProperty('--tilt-y', '0deg');
        });
      });
    }

    setupRipples(root) {
      if (this.reduceMotion) return;
      root.querySelectorAll?.(SELECTORS.ripple).forEach(button => {
        if (button.dataset.rippleReady) return;
        button.dataset.rippleReady = 'true';
        button.classList.add('has-ripple');
        button.addEventListener('pointerdown', event => {
          if (document.hidden || window.BDUMotion?.effectiveMode === 'reduced') return;
          const bounds = button.getBoundingClientRect();
          const ripple = document.createElement('span');
          ripple.className = 'showcase-ripple';
          ripple.style.left = `${event.clientX - bounds.left}px`;
          ripple.style.top = `${event.clientY - bounds.top}px`;
          button.appendChild(ripple);
          ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
        });
      });
    }

    setupStatAnimations(root = document) {
      root.querySelectorAll?.('.stat-card').forEach(card => {
        if (card.dataset.statAnimationReady) return;
        card.dataset.statAnimationReady = 'true';
        const value = card.querySelector('.stat-value');
        if (!value) return;
        this.updateLoadingState(value);
        const observer = new MutationObserver(() => {
          this.updateLoadingState(value);
          this.animateNumericValue(value);
        });
        observer.observe(value, { childList: true, characterData: true, subtree: true });
      });
    }

    updateLoadingState(value) {
      value.closest('.stat-card')?.classList.toggle('is-loading', value.textContent.trim() === '--');
    }

    animateNumericValue(element) {
      if (this.reduceMotion || !window.BDUMotion?.canAnimate?.() || element.dataset.animating === 'true') return;
      const raw = element.textContent.trim();
      if (element.dataset.animatedValue === raw) return;
      const match = raw.match(/^([0-9]+(?:\.[0-9]+)?)(.*)$/);
      if (!match) return;
      const target = Number(match[1]);
      const suffix = match[2];
      if (!Number.isFinite(target)) return;
      const decimals = match[1].includes('.') ? Math.min(match[1].split('.')[1].length, 2) : 0;
      const duration = 700;
      const started = performance.now();
      element.dataset.animatedValue = raw;
      element.dataset.animating = 'true';
      const tick = now => {
        const progress = Math.min((now - started) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 4);
        element.textContent = `${(target * eased).toFixed(decimals)}${suffix}`;
        if (progress < 1) requestAnimationFrame(tick);
        else {
          element.textContent = raw;
          element.dataset.animating = 'false';
        }
      };
      requestAnimationFrame(tick);
    }

    setupMobileSidebar() {
      const sidebar = document.querySelector('.sidebar');
      const toggle = document.getElementById('btn-toggle-sidebar');
      if (!sidebar || !toggle) return;
      const backdrop = document.createElement('button');
      backdrop.type = 'button';
      backdrop.className = 'sidebar-backdrop';
      backdrop.setAttribute('aria-label', 'Đóng menu');
      document.getElementById('dashboard-view')?.appendChild(backdrop);

      const sync = () => {
        const open = sidebar.classList.contains('open') && window.innerWidth <= 992;
        backdrop.classList.toggle('is-visible', open);
        toggle.setAttribute('aria-expanded', String(open));
      };
      this.sidebarObserver = new MutationObserver(sync);
      this.sidebarObserver.observe(sidebar, { attributes: true, attributeFilter: ['class'] });
      backdrop.addEventListener('click', () => sidebar.classList.remove('open'));
      window.addEventListener('resize', sync, { passive: true });
      document.addEventListener('keydown', event => {
        if (event.key === 'Escape') sidebar.classList.remove('open');
      });
      sync();
    }

    setupNetworkBeacon() {
      const actions = document.querySelector('.topbar-actions');
      if (!actions) return;
      const beacon = document.createElement('div');
      beacon.className = 'status-beacon';
      beacon.setAttribute('aria-live', 'polite');
      actions.prepend(beacon);
      const update = () => {
        beacon.textContent = navigator.onLine ? 'Hệ thống sẵn sàng' : 'Đang ngoại tuyến';
        beacon.classList.toggle('is-offline', !navigator.onLine);
      };
      window.addEventListener('online', update);
      window.addEventListener('offline', update);
      update();
    }

    setupScrollProgress() {
      const scroller = document.querySelector('.dashboard-body');
      const topbar = document.querySelector('.topbar');
      if (!scroller || !topbar) return;
      let frame = 0;
      const update = () => {
        const max = scroller.scrollHeight - scroller.clientHeight;
        topbar.style.setProperty('--scroll-progress', max > 0 ? (scroller.scrollTop / max).toFixed(4) : '0');
        frame = 0;
      };
      scroller.addEventListener('scroll', () => {
        if (!frame) frame = requestAnimationFrame(update);
      }, { passive: true });
      update();
    }

    setupRovingNavigation() {
      const items = [...document.querySelectorAll('.nav-item')];
      if (!items.length) return;
      const syncTabIndex = active => items.forEach(item => { item.tabIndex = item === active ? 0 : -1; });
      syncTabIndex(document.querySelector('.nav-item.active') || items[0]);
      items.forEach((item, index) => {
        item.addEventListener('click', () => syncTabIndex(item));
        item.addEventListener('keydown', event => {
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          let targetIndex = index;
          if (event.key === 'ArrowDown') targetIndex = (index + 1) % items.length;
          if (event.key === 'ArrowUp') targetIndex = (index - 1 + items.length) % items.length;
          if (event.key === 'Home') targetIndex = 0;
          if (event.key === 'End') targetIndex = items.length - 1;
          syncTabIndex(items[targetIndex]);
          items[targetIndex].focus();
        });
      });
    }

    enhanceCourseRows(root) {
      root.querySelectorAll?.('.course-row').forEach(row => {
        if (row.dataset.keyboardReady) return;
        row.dataset.keyboardReady = 'true';
        row.tabIndex = 0;
        row.setAttribute('role', 'button');
        row.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            row.click();
          }
        });
      });
    }

    setupDynamicEnhancement() {
      const dashboard = document.getElementById('dashboard-view');
      if (!dashboard) return;
      let scheduled = false;
      this.mutationObserver = new MutationObserver(mutations => {
        if (scheduled || !mutations.some(mutation => mutation.addedNodes.length)) return;
        scheduled = true;
        requestAnimationFrame(() => {
          const roots = mutations.flatMap(mutation => [...mutation.addedNodes])
            .filter(node => node.nodeType === Node.ELEMENT_NODE);
          roots.forEach(root => {
            this.observeRevealElements(root);
            this.setupTiltCards(root);
            this.setupRipples(root);
            this.setupStatAnimations(root);
            this.enhanceCourseRows(root);
          });
          scheduled = false;
        });
      });
      this.mutationObserver.observe(dashboard, { childList: true, subtree: true });
    }
  }

  const bootShowcase = () => {
    if (window.BDUShowcase) return;
    const showcase = new ShowcaseUI();
    showcase.init();
    window.BDUShowcase = showcase;
  };
  if (!document.readyState || document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootShowcase, { once: true });
  else bootShowcase();
})();
