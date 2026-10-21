/* iPad GM UI: map-first drawers, without changing desktop behavior. */
(() => {
  if (!document.body.classList.contains('gm-page')) return;

  const tabletQuery = matchMedia('(any-pointer: coarse) and (min-width: 680px)');
  const viewport = document.getElementById('viewport');
  if (!viewport) return;

  const isTablet = () => document.body.classList.contains('tablet-layout');

  function closeStandalonePanel(panelId, buttonId) {
    const panel = document.getElementById(panelId);
    const button = document.getElementById(buttonId);
    if (panel) panel.hidden = true;
    if (button) {
      button.classList.remove('active');
      button.setAttribute('aria-expanded', 'false');
    }
  }

  function closeOthers(except = '') {
    if (!isTablet()) return;
    // Existing app.js setters also update ARIA and active button state.
    document.dispatchEvent(new CustomEvent('mapfog:tablet-close-native-panels', {
      detail: { except }
    }));
    if (except !== 'dice') closeStandalonePanel('diceToolbar', 'diceToggleBtn');
  }

  function updateMode() {
    const wasTablet = isTablet();
    document.body.classList.toggle('tablet-layout', tabletQuery.matches);
    if (tabletQuery.matches && !wasTablet) {
      closeOthers();
      // 先攻在左上，不和右上面板互斥；只在剛進入平板布局時預設收起。
      closeStandalonePanel('initiativePanel', 'initiativePanelBtn');
    }
  }

  // Capture before the original controls' click handlers run. The selected
  // panel still uses its original toggle handler (and remains functional).
  document.addEventListener('click', (event) => {
    if (!isTablet()) return;
    const button = event.target.closest?.('button');
    if (!button) return;
    const buttons = {
      mapSettingsBtn: 'controls',
      gridSettingsBtn: 'grid',
      tokenSettingsBtn: 'token',
      mapAdjustBtn: 'mapAdjust',
      diceToggleBtn: 'dice'
    };
    if (buttons[button.id]) closeOthers(buttons[button.id]);
  }, true);

  // 點地圖不再關閉面板：操作地圖時由 panel-layout.js 暫時隱藏，放開後恢復。

  document.addEventListener('keydown', (event) => {
    if (isTablet() && event.key === 'Escape') closeOthers();
  });

  tabletQuery.addEventListener?.('change', updateMode);
  updateMode();
})();
