const clock = document.getElementById("clock");
const heroStatus = document.getElementById("heroStatus");
const flowList = document.getElementById("flowList");
const poolGrid = document.getElementById("poolGrid");
const poolCount = document.getElementById("poolCount");
const messageField = document.getElementById("message");
const submitButton = document.getElementById("submitSignal");
const featuredCards = document.querySelectorAll("[data-featured-card]");

const liveSignals = [
  {
    flag: "🇯🇵",
    country: "日本",
    city: "东京",
    time: "21:14",
    text: "东京地铁延误正在扩大",
    tag: "#交通"
  },
  {
    flag: "🇫🇮",
    country: "芬兰",
    city: "赫尔辛基",
    time: "20:48",
    text: "主干道积雪增厚导致车速下降",
    tag: "#天气"
  },
  {
    flag: "🇦🇷",
    country: "阿根廷",
    city: "布宜诺斯艾利斯",
    time: "20:06",
    text: "多个路口停电后交通灯暂时失效",
    tag: "#停电"
  },
  {
    flag: "🇫🇷",
    country: "法国",
    city: "巴黎",
    time: "19:42",
    text: "议会周边人流增加，街区通行变慢",
    tag: "#集会"
  }
];

function updateClock() {
  const now = new Date();
  clock.textContent = now.toLocaleString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "UTC"
  }) + " 世界标准时间";
}

function updateHeroAndPoolCount() {
  const countText = String(liveSignals.length).padStart(2, "0");
  const heroCount = heroStatus.querySelector(".hero-count");
  if (heroCount) {
    heroCount.textContent = countText;
  }
  poolCount.textContent = `可见信号 ${countText}`;
}

function createSignalElement(signal) {
  const article = document.createElement("article");
  article.className = "live-item signal";
  article.innerHTML = `
    <button type="button" class="signal-trigger" aria-expanded="false">
      <div class="live-meta">
        <span>${signal.flag}</span>
        <span class="live-location">${signal.country} · ${signal.city}</span>
        <span class="live-time">· ${signal.time}</span>
        <span class="live-tag">${signal.tag}</span>
      </div>
      <p class="live-text">${signal.text}</p>
    </button>
    <div class="signal-details">
      <p>△ 时间线：正在持续写入本地原始记录。</p>
      <p>△ 关联信号：附近区域出现相似关键词。</p>
      <p>△ 附近地点：可在展开面板继续查看。</p>
    </div>
  `;

  const trigger = article.querySelector(".signal-trigger");
  trigger.addEventListener("click", () => {
    const isOpen = article.classList.toggle("open");
    trigger.setAttribute("aria-expanded", String(isOpen));
  });
  return article;
}

function renderLiveFeed() {
  flowList.innerHTML = "";
  liveSignals.forEach((signal) => {
    flowList.appendChild(createSignalElement(signal));
  });
}

function renderPool() {
  poolGrid.innerHTML = "";
  liveSignals.concat(liveSignals).forEach((signal, index) => {
    const item = document.createElement("article");
    item.className = "pool-item";
    item.innerHTML = `
      <div class="pool-row">${signal.flag} ${signal.country} · ${signal.city} · ${signal.time}</div>
      <div class="pool-main">${signal.text}</div>
      <div class="pool-row">${signal.tag} · 原始信号 #${index + 1}</div>
    `;
    poolGrid.appendChild(item);
  });
}

function submitSignal() {
  const text = messageField.value.trim();
  if (!text) {
    return;
  }

  const now = new Date().toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC"
  });

  liveSignals.unshift({
    flag: "🇨🇳",
    country: "中国",
    city: "用户提交",
    time: now,
    text,
    tag: "#现场"
  });

  messageField.value = "";
  renderLiveFeed();
  renderPool();
  updateHeroAndPoolCount();
}

let featuredPopover = null;
let featuredPopoverCloseBtn = null;
let featuredPopoverBody = null;
let featuredPopoverTitle = null;
let activeFeaturedCard = null;
let hidePopoverTimer = null;

function truncateWithAsciiEllipsis(text, maxChars) {
  const normalized = (text || "").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars).trim()}...`;
}

function applyFeaturedCompactPreview() {
  const rules = [
    { selector: ".featured-time", maxChars: 18 },
    { selector: ".featured-location", maxChars: 24 },
    { selector: ".featured-event", maxChars: 32 },
    { selector: ".featured-origin", maxChars: 42 },
    { selector: ".featured-ai", maxChars: 46 }
  ];

  featuredCards.forEach((card) => {
    rules.forEach((rule) => {
      const node = card.querySelector(rule.selector);
      if (!node) {
        return;
      }
      if (!node.dataset.fullText) {
        node.dataset.fullText = node.textContent || "";
      }
      node.textContent = truncateWithAsciiEllipsis(node.dataset.fullText, rule.maxChars);
    });
  });
}

function ensureFeaturedPopover() {
  if (featuredPopover) {
    return;
  }

  featuredPopover = document.createElement("div");
  featuredPopover.className = "featured-popover";
  featuredPopover.setAttribute("aria-hidden", "true");
  featuredPopover.innerHTML = `
    <div class="featured-popover-top">
      <p class="featured-popover-title">详细内容</p>
      <button type="button" class="featured-popover-close">关闭</button>
    </div>
    <div class="featured-popover-body"></div>
  `;

  document.body.appendChild(featuredPopover);
  featuredPopoverCloseBtn = featuredPopover.querySelector(".featured-popover-close");
  featuredPopoverBody = featuredPopover.querySelector(".featured-popover-body");
  featuredPopoverTitle = featuredPopover.querySelector(".featured-popover-title");

  featuredPopoverCloseBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    closeFeaturedPopover();
  });
}

function getFeaturedCardData(card) {
  const readText = (selector) => {
    const node = card.querySelector(selector);
    if (!node) {
      return "";
    }
    return node.dataset.fullText || node.textContent || "";
  };

  return {
    time: readText(".featured-time"),
    location: readText(".featured-location"),
    event: readText(".featured-event"),
    origin: readText(".featured-origin"),
    ai: readText(".featured-ai")
  };
}

function positionFeaturedPopover(card) {
  if (!featuredPopover) {
    return;
  }

  const rect = card.getBoundingClientRect();
  const desiredWidth = Math.max(rect.width + 220, 700);
  const popoverWidth = Math.min(desiredWidth, window.innerWidth - 24);
  featuredPopover.style.width = `${popoverWidth}px`;

  featuredPopover.classList.remove("placement-bottom");
  featuredPopover.style.visibility = "hidden";
  featuredPopover.classList.add("is-open");
  const popoverHeight = featuredPopover.offsetHeight;
  featuredPopover.classList.remove("is-open");
  featuredPopover.style.visibility = "";

  let left = rect.left + (rect.width - popoverWidth) / 2;
  left = Math.max(12, Math.min(left, window.innerWidth - popoverWidth - 12));
  left = Math.round(left);

  const topAsAbove = rect.top - 24;
  const showBelow = topAsAbove < 12;
  const maxTop = window.innerHeight - popoverHeight - 12;
  const top = showBelow
    ? Math.min(maxTop, rect.bottom - rect.height * 0.2)
    : Math.min(maxTop, topAsAbove);

  featuredPopover.style.left = `${left}px`;
  featuredPopover.style.top = `${Math.round(top)}px`;
  featuredPopover.classList.toggle("placement-bottom", showBelow);
}

function openFeaturedPopover(card) {
  ensureFeaturedPopover();

  if (hidePopoverTimer) {
    clearTimeout(hidePopoverTimer);
    hidePopoverTimer = null;
  }

  const data = getFeaturedCardData(card);
  featuredPopoverTitle.textContent = data.location || "详细内容";
  featuredPopoverBody.innerHTML = `
    <p class="featured-time">${data.time}</p>
    <p class="featured-location">${data.location}</p>
    <p class="featured-event">${data.event}</p>
    <p class="featured-origin">${data.origin}</p>
    <p class="featured-ai">${data.ai}</p>
  `;

  if (activeFeaturedCard && activeFeaturedCard !== card) {
    activeFeaturedCard.classList.remove("is-source-active");
    activeFeaturedCard.setAttribute("aria-expanded", "false");
  }

  activeFeaturedCard = card;
  card.classList.add("is-source-active");
  card.setAttribute("aria-expanded", "true");

  positionFeaturedPopover(card);
  featuredPopover.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => {
    featuredPopover.classList.add("is-open");
  });
}

function closeFeaturedPopover() {
  if (!featuredPopover || !activeFeaturedCard) {
    return;
  }

  featuredPopover.classList.remove("is-open");
  featuredPopover.setAttribute("aria-hidden", "true");

  activeFeaturedCard.classList.remove("is-source-active");
  activeFeaturedCard.setAttribute("aria-expanded", "false");
  activeFeaturedCard = null;

  hidePopoverTimer = setTimeout(() => {
    if (featuredPopover) {
      featuredPopover.style.left = "-9999px";
      featuredPopover.style.top = "-9999px";
    }
  }, 320);
}

function bindFeaturedCards() {
  featuredCards.forEach((card) => {
    card.setAttribute("tabindex", "0");
    card.setAttribute("role", "button");
    card.setAttribute("aria-expanded", "false");

    card.addEventListener("click", (event) => {
      event.stopPropagation();
      if (activeFeaturedCard === card) {
        closeFeaturedPopover();
      } else {
        openFeaturedPopover(card);
      }
    });

    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (activeFeaturedCard === card) {
          closeFeaturedPopover();
        } else {
          openFeaturedPopover(card);
        }
      }
    });
  });

  document.addEventListener("click", (event) => {
    if (!activeFeaturedCard || !featuredPopover) {
      return;
    }
    if (featuredPopover.contains(event.target)) {
      return;
    }
    if (activeFeaturedCard.contains(event.target)) {
      return;
    }
    closeFeaturedPopover();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && activeFeaturedCard) {
      closeFeaturedPopover();
    }
  });

  window.addEventListener("resize", () => {
    if (activeFeaturedCard) {
      positionFeaturedPopover(activeFeaturedCard);
    }
  });

  window.addEventListener("scroll", () => {
    if (activeFeaturedCard) {
      positionFeaturedPopover(activeFeaturedCard);
    }
  }, { passive: true });
}

submitButton.addEventListener("click", submitSignal);
messageField.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    submitSignal();
  }
});

updateClock();
renderLiveFeed();
renderPool();
updateHeroAndPoolCount();
applyFeaturedCompactPreview();
bindFeaturedCards();
setInterval(updateClock, 1000);