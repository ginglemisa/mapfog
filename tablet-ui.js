/* iPad GM UI: map-first drawers, without changing desktop behavior. */
(() => {
  if (!document.body.classList.contains('gm-page')) return;

  const tabletQuery = matchMedia('(any-pointer: coarse) and (min-width: 680px)');
  const controls = document.getElementById('controlsPanel');
  const viewport = document.getElementById('viewport');
  if (!controls || !viewport) return;

  const heading = document.createElement('div');
  heading.className = 'tablet-controls-heading';
  const headingLabel = document.createElement('span');
  headingLabel.textContent = '地圖設定';
  const closeButton = document.createElement('button');
  closeButton.className = 'tablet-close-button';
  closeButton.type = 'button';
  closeButton.textContent = '×';
  closeButton.title = '關閉地圖設定';
  closeButton.setAttribute('aria-label', '關閉地圖設定');
  heading.append(headingLabel, closeButton);
  controls.prepend(heading);

  const settingsButton = document.createElement('button');
  settingsButton.id = 'tabletSettingsBtn';
  settingsButton.className = 'tablet-settings-toggle';
  settingsButton.type = 'button';
  settingsButton.textContent = '地圖設定';
  settingsButton.setAttribute('aria-controls', 'controlsPanel');
  settingsButton.setAttribute('aria-expanded', 'false');
  viewport.appendChild(settingsButton);

  const isTablet = () => document.body.classList.contains('tablet-layout');

  function closeSettings() {
    controls.classList.remove('tablet-open');
    settingsButton.setAttribute('aria-expanded', 'false');
  }

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
    if (except !== 'settings') closeSettings();
    // Existing app.js setters also update ARIA and active button state.
    document.dispatchEvent(new CustomEvent('mapfog:tablet-close-native-panels', {
      detail: { except }
    }));
    if (except !== 'initiative') closeStandalonePanel('initiativePanel', 'initiativePanelBtn');
    if (except !== 'dice') closeStandalonePanel('diceToolbar', 'diceToggleBtn');
  }

  function updateMode() {
    const wasTablet = isTablet();
    document.body.classList.toggle('tablet-layout', tabletQuery.matches);
    if (!tabletQuery.matches) closeSettings();
    else if (!wasTablet) closeOthers();
  }

  settingsButton.addEventListener('click', () => {
    const open = !controls.classList.contains('tablet-open');
    if (open) closeOthers('settings');
    controls.classList.toggle('tablet-open', open);
    settingsButton.setAttribute('aria-expanded', String(open));
  });
  closeButton.addEventListener('click', closeSettings);

  // Capture before the original controls' click handlers run. The selected
  // panel still uses its original toggle handler (and remains functional).
  document.addEventListener('click', (event) => {
    if (!isTablet()) return;
    const button = event.target.closest?.('button');
    if (!button) return;
    const buttons = {
      gridSettingsBtn: 'grid',
      tokenSettingsBtn: 'token',
      initiativePanelBtn: 'initiative',
      diceToggleBtn: 'dice'
    };
    if (buttons[button.id]) closeOthers(buttons[button.id]);
  }, true);

  viewport.addEventListener('pointerdown', (event) => {
    if (!isTablet()) return;
    if (event.target.closest?.('#floatingToolbar, #toolbarToggleBtn, #tabletSettingsBtn, #gridPanel, #tokenPanel, #initiativePanel, #diceToolbar')) return;
    closeOthers();
  }, true);

  document.addEventListener('keydown', (event) => {
    if (isTablet() && event.key === 'Escape') closeOthers();
  });

  tabletQuery.addEventListener?.('change', updateMode);
  updateMode();
})();
