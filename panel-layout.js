// 面板的位置與顯示規則（GM 與玩家頁共用）：
// - 操作地圖（擦霧、補霧、拖曳地圖或 token、雙指縮放）時暫時隱藏所有面板，放開後恢復；原本關著的不會被打開。
// - GM 電腦版：右上的面板可以同時開，依打開順序由右往左排，放不下就排到下一排，不互相重疊。
// - GM 右下角模式按鈕的高度提供給平板版抽屜，讓抽屜停在按鈕上方。
// - 玩家頁：骰子面板和 Token 面板在同一個位置，同時間只開一個。
(() => {
  const viewport = document.getElementById("viewport");
  if (!viewport) return;

  const isGmPage = document.body.classList.contains("gm-page");
  const rootStyle = document.documentElement.style;
  const GAP = 8;
  const EDGE = 8;
  // 面板太矮就沒有意義，至少留這麼高，必要時讓它自己捲動。
  const MIN_PANEL_HEIGHT = 160;
  const UI_SELECTOR = [
    ".floating-toolbar",
    ".mode-dock",
    ".controls-panel",
    ".grid-panel",
    ".token-panel",
    ".map-adjust-panel",
    ".mapfog-initiative-panel",
    ".dice-toolbar",
    ".initiative-modal-backdrop"
  ].join(",");

  setupHideWhileInteracting();
  if (isGmPage) {
    setupModeDockSpace();
    setupDesktopPanelStacking();
  } else {
    setupPlayerDiceTokenExclusive();
  }

  function setupHideWhileInteracting() {
    const activePointers = new Set();
    const setInteracting = (on) => document.body.classList.toggle("map-interacting", on);
    const release = (event) => {
      if (!activePointers.delete(event.pointerId)) return;
      if (!activePointers.size) setInteracting(false);
    };
    const releaseAll = () => {
      activePointers.clear();
      setInteracting(false);
    };

    // 捕獲階段先看到，地圖或 token 自己的處理程式停止傳遞也不影響。
    document.addEventListener("pointerdown", (event) => {
      const target = event.target;
      if (!(target instanceof Element) || !viewport.contains(target)) return;
      if (target.closest(UI_SELECTOR)) return;
      activePointers.add(event.pointerId);
      setInteracting(true);
    }, true);
    window.addEventListener("pointerup", release, true);
    window.addEventListener("pointercancel", release, true);
    window.addEventListener("blur", releaseAll);
    document.addEventListener("visibilitychange", releaseAll);
  }

  function setupModeDockSpace() {
    const dock = document.getElementById("modeDock");
    if (!dock) return;
    const update = () => {
      const rect = dock.getBoundingClientRect();
      rootStyle.setProperty("--mode-dock-space", `${Math.max(0, window.innerHeight - rect.top + GAP)}px`);
    };
    if ("ResizeObserver" in window) new ResizeObserver(update).observe(dock);
    window.addEventListener("resize", update);
    update();
  }

  function setupDesktopPanelStacking() {
    const panels = ["controlsPanel", "gridPanel", "tokenPanel", "mapAdjustPanel", "diceToolbar"]
      .map((id) => document.getElementById(id))
      .filter(Boolean);
    const sideToolbar = document.getElementById("sideToolbar");
    const dock = document.getElementById("modeDock");
    const initiativePanel = document.getElementById("initiativePanel");
    let openOrder = panels.filter((panel) => !panel.hidden);
    let timer = 0;

    const isTablet = () => document.body.classList.contains("tablet-layout");
    const isVisible = (element) => Boolean(element && !element.hidden && element.offsetParent !== null);
    // 同一輪的多個變化只排一次版。不用 requestAnimationFrame：分頁在背景時它不會執行。
    const schedule = () => {
      if (timer) return;
      timer = window.setTimeout(() => {
        timer = 0;
        layout();
      }, 0);
    };

    function clearInlinePosition(panel) {
      panel.style.top = "";
      panel.style.right = "";
      panel.style.left = "";
      panel.style.maxHeight = "";
    }

    function layout() {
      if (isTablet()) {
        panels.forEach(clearInlinePosition);
        return;
      }

      const anchorRect = sideToolbar?.getBoundingClientRect();
      const anchorRight = anchorRect ? anchorRect.right : window.innerWidth - EDGE;
      const firstTop = (anchorRect ? anchorRect.bottom : 64) + GAP;
      const screenBottom = window.innerHeight - EDGE;
      // 不能蓋到的區域：先攻面板、右下角模式按鈕，以及已經排好的面板。
      const placed = [initiativePanel, dock]
        .filter(isVisible)
        .map((element) => element.getBoundingClientRect())
        .map(({ left, top, right, bottom }) => ({ left, top, right, bottom }));
      const overlaps = (a, b) => a.left < b.right + GAP && a.right + GAP > b.left && a.top < b.bottom + GAP && a.bottom + GAP > b.top;

      // 在 (right, top) 放一個寬 width、原本高 naturalHeight 的面板；往下碰到東西時可以變矮，但不能矮於下限。
      const tryPlace = (right, top, width, naturalHeight) => {
        const left = right - width;
        if (left < EDGE || top < firstTop) return null;
        let bottomLimit = screenBottom;
        for (const rect of placed) {
          if (rect.left < right + GAP && rect.right + GAP > left && rect.top >= top) bottomLimit = Math.min(bottomLimit, rect.top - GAP);
        }
        const height = Math.min(naturalHeight, bottomLimit - top);
        if (height < Math.min(naturalHeight, MIN_PANEL_HEIGHT)) return null;
        const candidate = { left, top, right, bottom: top + height };
        return placed.some((rect) => overlaps(candidate, rect)) ? null : candidate;
      };

      for (const panel of openOrder) {
        if (panel.hidden) continue;
        clearInlinePosition(panel);
        const width = panel.offsetWidth;
        const naturalHeight = panel.offsetHeight;

        // 先由右往左排在最上面一排，放不下再找已排面板下方的空位。
        const tops = [firstTop, ...placed.map((rect) => rect.bottom + GAP)].sort((a, b) => a - b);
        const rights = [anchorRight, ...placed.map((rect) => rect.left - GAP)].sort((a, b) => b - a);
        let spot = null;
        for (const top of tops) {
          for (const right of rights) {
            spot = tryPlace(right, top, width, naturalHeight);
            if (spot) break;
          }
          if (spot) break;
        }
        // 畫面真的放不下時才疊在右上角，維持在最上層可以操作。
        if (!spot) spot = { left: anchorRight - width, top: firstTop, right: anchorRight, bottom: Math.min(screenBottom, firstTop + naturalHeight) };

        panel.style.left = "auto";
        panel.style.right = `${Math.round(window.innerWidth - spot.right)}px`;
        panel.style.top = `${Math.round(spot.top)}px`;
        panel.style.maxHeight = `${Math.round(spot.bottom - spot.top)}px`;
        placed.push(spot);
      }
    }

    const observer = new MutationObserver((records) => {
      for (const record of records) {
        const panel = record.target;
        openOrder = openOrder.filter((item) => item !== panel);
        if (!panel.hidden) openOrder.push(panel);
        else clearInlinePosition(panel);
      }
      schedule();
    });
    panels.forEach((panel) => observer.observe(panel, { attributes: true, attributeFilter: ["hidden"] }));
    if (initiativePanel) observer.observe(initiativePanel, { attributes: true, attributeFilter: ["hidden"] });
    new MutationObserver(schedule).observe(document.body, { attributes: true, attributeFilter: ["class"] });

    if ("ResizeObserver" in window) {
      const resizeObserver = new ResizeObserver(schedule);
      [...panels, sideToolbar, dock, initiativePanel].filter(Boolean).forEach((element) => resizeObserver.observe(element));
    }
    window.addEventListener("resize", schedule);
    // 先攻面板拖曳結束後，右上的面板可能要讓位。
    window.addEventListener("pointerup", schedule);
    schedule();
  }

  function setupPlayerDiceTokenExclusive() {
    const tokenButton = document.getElementById("tokenSettingsBtn");
    const tokenPanel = document.getElementById("tokenPanel");
    const tokenCloseButton = document.getElementById("tokenPanelCloseBtn");
    const diceButton = document.getElementById("diceToggleBtn");
    const diceToolbar = document.getElementById("diceToolbar");
    if (!tokenButton || !tokenPanel || !diceButton || !diceToolbar) return;

    // 捕獲階段：按下的按鈕即將打開自己的面板時，先關掉另一個。
    document.addEventListener("click", (event) => {
      const button = event.target instanceof Element ? event.target.closest("button") : null;
      if (button === tokenButton && tokenPanel.hidden && !diceToolbar.hidden) {
        diceToolbar.hidden = true;
        diceButton.classList.remove("active");
        diceButton.setAttribute("aria-expanded", "false");
      } else if (button === diceButton && diceToolbar.hidden && !tokenPanel.hidden) {
        tokenCloseButton?.click();
      }
    }, true);
  }
})();
