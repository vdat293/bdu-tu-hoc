/** Swap the small login stylesheet for the full dashboard stylesheet on auth. */
(() => {
  const version = '20260905-perf-v22';
  const loginLink = () => document.querySelector('link[data-bdu-style="login"]');
  const dashboardLink = () => document.querySelector('link[data-bdu-style="dashboard"]');
  const load = (href, kind) => new Promise((resolve, reject) => {
    const existing = dashboardLink();
    if (existing && kind === 'dashboard') return resolve(existing);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.bduStyle = kind;
    link.onload = () => resolve(link);
    link.onerror = () => { link.remove(); reject(new Error(`Không thể tải stylesheet ${kind}.`)); };
    // The showcase layer is intentionally last: it contains the product
    // surface overrides for the base dashboard stylesheet. Insert the base
    // stylesheet before it so auth can keep the lightweight CSS split without
    // reversing the cascade used by the production page.
    const showcase = document.querySelector('link[href*="showcase.min.css"]');
    if (showcase) document.head.insertBefore(link, showcase);
    else document.head.appendChild(link);
  });

  window.BDUClientStyles = {
    ensureDashboard() {
      const existing = dashboardLink();
      if (existing) return Promise.resolve(existing);
      return load(`css/style.min.css?v=${version}`, 'dashboard').then(link => {
        const login = loginLink();
        if (login) login.disabled = true;
        return link;
      });
    },
    resetLogin() {
      const login = loginLink();
      if (login) login.disabled = false;
      const dashboard = dashboardLink();
      if (dashboard) dashboard.remove();
    }
  };
})();
