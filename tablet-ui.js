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

  // 左上與右上各自只開一個面板；左右兩邊可以同時各開一個。
  // 先攻按鈕在右上，但面板在左上，所以算左上。
  const GROUPS = {
    left: ['controls', 'grid', 'mapAdjust', 'initiative'],
    right: ['token', 'dice']
  };
  const STANDALONE = {
    initiative: ['initiativePanel', 'initiativePanelBtn'],
    dice: ['diceToolbar', 'diceToggleBtn']
  };

  function closePanels(names) {
    if (!isTablet() || !names.length) return;
    // Existing app.js setters also update ARIA and active button state.
    document.dispatchEvent(new CustomEvent('mapfog:tablet-close-native-panels', {
      detail: { close: names }
    }));
    for (const name of names) {
      if (STANDALONE[name]) closeStandalonePanel(...STANDALONE[name]);
    }
  }

  function closeOthersInGroup(name) {
    const group = GROUPS.left.includes(name) ? GROUPS.left : GROUPS.right;
    closePanels(group.filter((other) => other !== name));
  }

  const closeAll = () => closePanels([...GROUPS.left, ...GROUPS.right]);

  function updateMode() {
    const wasTablet = isTablet();
    document.body.classList.toggle('tablet-layout', tabletQuery.matches);
    if (tabletQuery.matches && !wasTablet) closeAll();
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
      initiativePanelBtn: 'initiative',
      diceToggleBtn: 'dice'
    };
    if (buttons[button.id]) closeOthersInGroup(buttons[button.id]);
  }, true);

  // 點地圖不再關閉面板：操作地圖時由 panel-layout.js 暫時隱藏，放開後恢復。

  document.addEventListener('keydown', (event) => {
    if (isTablet() && event.key === 'Escape') closeAll();
  });

  tabletQuery.addEventListener?.('change', updateMode);
  updateMode();
})();
