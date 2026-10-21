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

  // 左上、右上工具列同時只展開一組。展開的那組疊在另一組上面（可以蓋住旋轉或骰子），
  // 但寬度停在另一組的箭頭前面，所以兩邊的箭頭永遠按得到。
  const leftToolbar = document.getElementById('floatingToolbar');
  const rightToolbar = document.getElementById('sideToolbar');
  const leftToggle = document.getElementById('toolbarToggleBtn');
  const rightToggle = document.getElementById('sideToolbarToggleBtn');
  const hasToolbarPair = Boolean(leftToolbar && rightToolbar && leftToggle && rightToggle);
  const TOOLBAR_GAP = 6;
  const isExpanded = (toolbar) => !toolbar.classList.contains('collapsed');

  function updateToolbarLimits() {
    if (!hasToolbarPair || !isTablet()) return;
    const rootStyle = document.documentElement.style;
    const leftEdge = leftToolbar.getBoundingClientRect().left;
    const rightEdge = rightToolbar.getBoundingClientRect().right;
    const leftMax = rightToggle.getBoundingClientRect().left - TOOLBAR_GAP - leftEdge;
    const rightMax = rightEdge - leftToggle.getBoundingClientRect().right - TOOLBAR_GAP;
    rootStyle.setProperty('--tablet-left-toolbar-max', `${Math.max(0, Math.floor(leftMax))}px`);
    rootStyle.setProperty('--tablet-right-toolbar-max', `${Math.max(0, Math.floor(rightMax))}px`);
  }

  // 按另一組的箭頭會順便記住收合狀態，和手動收合一樣。
  function collapseOtherToolbar(opened) {
    if (!hasToolbarPair || !isTablet() || !isExpanded(opened)) return;
    const [other, otherToggle] = opened === leftToolbar ? [rightToolbar, rightToggle] : [leftToolbar, leftToggle];
    if (isExpanded(other)) otherToggle.click();
  }

  function updateMode() {
    const wasTablet = isTablet();
    document.body.classList.toggle('tablet-layout', tabletQuery.matches);
    if (tabletQuery.matches && !wasTablet) {
      closeAll();
      // 兩組都展開時留左上（地圖工具），收起右上。
      if (hasToolbarPair) collapseOtherToolbar(leftToolbar);
    }
    updateToolbarLimits();
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

  // 冒泡階段：app.js 已經切換好被按的那一組，再收起另一組。
  document.addEventListener('click', (event) => {
    const button = event.target.closest?.('button');
    if (button === leftToggle) collapseOtherToolbar(leftToolbar);
    else if (button === rightToggle) collapseOtherToolbar(rightToolbar);
  });

  if (hasToolbarPair) {
    window.addEventListener('resize', updateToolbarLimits);
    if ('ResizeObserver' in window) {
      const observer = new ResizeObserver(updateToolbarLimits);
      [leftToolbar, rightToolbar].forEach((toolbar) => observer.observe(toolbar));
    }
  }

  // 點地圖不再關閉面板：操作地圖時由 panel-layout.js 暫時隱藏，放開後恢復。

  document.addEventListener('keydown', (event) => {
    if (isTablet() && event.key === 'Escape') closeAll();
  });

  tabletQuery.addEventListener?.('change', updateMode);
  updateMode();
})();
