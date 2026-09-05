/** Mount heavy dashboard panes only when the user opens them. */
(() => {
  const mounted = new Set();
  const templateId = id => `bdu-view-fragment-${id}`;

  window.BDUViewFragments = {
    mount(id) {
      if (!id) return null;
      const existing = document.getElementById(id);
      if (existing) { mounted.add(id); return existing; }
      const template = document.getElementById(templateId(id));
      if (!template) return null;
      const content = template.content.cloneNode(true);
      const pane = [...content.querySelectorAll('.tab-pane')].find(item => item.id === id);
      if (!pane) return null;
      template.replaceWith(content);
      mounted.add(id);
      return document.getElementById(id) || pane;
    },
    isMounted(id) { return mounted.has(id) || Boolean(document.getElementById(id)); },
    snapshot() { return { mounted: [...mounted] }; }
  };
})();
