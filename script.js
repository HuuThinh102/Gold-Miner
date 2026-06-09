(function () {
  "use strict";

  const CANVAS_WIDTH = 800;
  const CANVAS_HEIGHT = 700;
  const MINER_HEIGHT = 240;
  const GROUND_Y = MINER_HEIGHT + 20;

  const BASE_SWING_SPEED = 0.02;
  const SWING_SPEED_PER_LEVEL = 0.0012;
  const LEVEL_COUNT = 50;
  const HOOK_REST_LENGTH = 70;
  const HOOK_EXTEND_SPEED = 6;
  const HOOK_RETRACT_BASE = 5;
  const WALL_MARGIN = 25;
  const FLOOR_MARGIN = 8;
  const HOOK_CLAW_DEPTH = 18;
  const HOOK_RADIUS = 14;

  const ITEM_TYPES = {
    diamond: {
      image: "assets/diamond.png",
      value: 700,
      weight: 1,
      sizes: [30, 42, 55],
      penalty: false,
    },
    ruby: {
      image: "assets/ruby.png",
      value: 500,
      weight: 1.5,
      sizes: [32, 45, 58],
      penalty: false,
    },
    gold: {
      image: "assets/gold.png",
      value: 300,
      weight: 2,
      sizes: [40, 55, 70],
      penalty: false,
    },
    rock: {
      image: "assets/rock.png",
      value: 20,
      weight: 5,
      sizes: [45, 60, 75],
      penalty: false,
    },
    durian: {
      image: "assets/durian.png",
      value: -50,
      weight: 3,
      sizes: [50, 65, 80],
      penalty: true,
    },
  };

  const LEVELS = Array.from({ length: LEVEL_COUNT }, (_, i) => ({
    target: Math.round(650 + i * 200 + Math.floor(i / 10) * 250),
    time: Math.max(40, 60 - Math.floor(i / 2)),
    diamondCount: Math.min(3, 1 + Math.floor(i / 15)),
    rubyCount: Math.min(4, 1 + Math.floor(i / 10)),
    goldCount: Math.min(10, 4 + Math.floor(i / 5)),
    rockCount: Math.min(10, 3 + Math.floor(i / 6)),
    durianCount: Math.min(4, 1 + Math.floor(i / 12)),
  }));

  const canvas = document.getElementById("game-canvas");
  const ctx = canvas.getContext("2d");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlayMessage = document.getElementById("overlay-message");
  const overlayBtn = document.getElementById("overlay-btn");
  const targetScoreEl = document.getElementById("target-score");
  const currentScoreEl = document.getElementById("current-score");
  const timerEl = document.getElementById("timer");
  const levelEl = document.getElementById("level");
  const pauseBtn = document.getElementById("pause-btn");

  // ── Fixed logical size; CSS scales it visually ──────────────────────────
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;

  // Convert a click/touch position (CSS pixels) → logical canvas coordinates
  function toLogical(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_WIDTH / rect.width;
    const scaleY = CANVAS_HEIGHT / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  const images = {};
  let items = [];
  let score = 0;
  let level = 0;
  let timeLeft = 60;
  let timerInterval = null;
  let gameState = "menu";
  let swingAngle = 0;
  let swingDirection = 1;
  let hookLength = 0;
  let hookState = "swinging";
  let caughtItem = null;
  let pivotX = CANVAS_WIDTH / 2;
  let pivotY = MINER_HEIGHT - 18;
  let lastTime = 0;
  let animFrame = null;
  let isPaused = false;

  function loadImage(key, src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        images[key] = img;
        resolve();
      };
      img.onerror = reject;
      img.src = src;
    });
  }

  function randomBetween(min, max) {
    return min + Math.random() * (max - min);
  }
  function getSwingSpeed() {
    return BASE_SWING_SPEED + level * SWING_SPEED_PER_LEVEL;
  }

  function getItemValue(def, size) {
    const refSize = def.sizes[1];
    return Math.round(def.value * (refSize / size));
  }
  function getItemWeight(def, size) {
    const refSize = def.sizes[1];
    return def.weight * (size / refSize);
  }

  function getSwingLimits(length) {
    const len = Math.max(length, 1);
    const cosLeft = (WALL_MARGIN - pivotX) / len;
    const cosRight = (CANVAS_WIDTH - WALL_MARGIN - pivotX) / len;
    let leftAmp = Math.PI / 2 - 0.04;
    let rightAmp = -(Math.PI / 2 - 0.04);
    if (cosLeft >= -1 && cosLeft <= 0)
      leftAmp = Math.acos(cosLeft) - Math.PI / 2;
    if (cosRight >= 0 && cosRight <= 1)
      rightAmp = Math.acos(cosRight) - Math.PI / 2;
    return { left: leftAmp, right: rightAmp };
  }

  function getFloorTipY() {
    return CANVAS_HEIGHT - FLOOR_MARGIN - HOOK_CLAW_DEPTH;
  }
  function getMaxHookLength() {
    const angle = swingAngle + Math.PI / 2;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const floorTipY = getFloorTipY();
    let maxLen = (floorTipY - pivotY) / Math.max(sinA, 0.001);
    if (cosA < -0.001)
      maxLen = Math.min(maxLen, (pivotX - WALL_MARGIN) / -cosA);
    else if (cosA > 0.001)
      maxLen = Math.min(maxLen, (CANVAS_WIDTH - WALL_MARGIN - pivotX) / cosA);
    return Math.max(HOOK_REST_LENGTH, maxLen);
  }

  function getHookTip() {
    const angle = swingAngle + Math.PI / 2;
    return {
      x: pivotX + Math.cos(angle) * hookLength,
      y: pivotY + Math.sin(angle) * hookLength,
    };
  }

  function spawnItems(config) {
    items = [];
    const types = [];
    for (let i = 0; i < config.diamondCount; i++) types.push("diamond");
    for (let i = 0; i < config.rubyCount; i++) types.push("ruby");
    for (let i = 0; i < config.goldCount; i++) types.push("gold");
    for (let i = 0; i < config.rockCount; i++) types.push("rock");
    for (let i = 0; i < config.durianCount; i++) types.push("durian");

    for (let i = types.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [types[i], types[j]] = [types[j], types[i]];
    }

    const margin = 60;
    const placed = [];

    types.forEach((type) => {
      const def = ITEM_TYPES[type];
      const size = def.sizes[Math.floor(Math.random() * def.sizes.length)];
      let x,
        y,
        attempts = 0;

      do {
        x = randomBetween(margin + size / 2, CANVAS_WIDTH - margin - size / 2);
        y = randomBetween(GROUND_Y + 80, CANVAS_HEIGHT - margin - size / 2);
        attempts++;
      } while (
        attempts < 80 &&
        placed.some(
          (p) => Math.hypot(p.x - x, p.y - y) < (p.size + size) / 2 + 15,
        )
      );

      placed.push({ x, y, size });
      items.push({
        type,
        x,
        y,
        size,
        value: getItemValue(def, size),
        weight: getItemWeight(def, size),
        caught: false,
      });
    });
  }

  function updateHUD() {
    const config = LEVELS[level];
    targetScoreEl.textContent = `$${config.target}`;
    currentScoreEl.textContent = `$${score}`;
    timerEl.textContent = Math.ceil(timeLeft);
    levelEl.textContent = level + 1;
  }

  function startTimer() {
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      if (gameState !== "playing") return;
      timeLeft -= 1;
      updateHUD();
      if (timeLeft <= 0) endLevel();
    }, 1000);
  }

  function startLevel(lvl) {
    level = lvl;
    const config = LEVELS[level];
    score = 0;
    timeLeft = config.time;
    swingAngle = 0;
    swingDirection = 1;
    hookLength = HOOK_REST_LENGTH;
    hookState = "swinging";
    caughtItem = null;
    isPaused = false;
    pauseBtn.textContent = "⏸ Dừng";
    pauseBtn.classList.remove("paused");
    spawnItems(config);
    updateHUD();
    gameState = "playing";
    overlay.classList.add("hidden");
    startTimer();
  }

  function checkLevelComplete() {
    if (gameState !== "playing") return;
    if (score >= LEVELS[level].target) endLevel();
  }

  function endLevel() {
    clearInterval(timerInterval);
    gameState = "ended";
    const config = LEVELS[level];
    if (score >= config.target) {
      if (level < LEVELS.length - 1) {
        showOverlay(
          "Chúc mừng!",
          `Bạn kiếm được $${score}! Vượt qua màn ${level + 1}. Sẵn sàng cho màn tiếp?`,
          "Màn tiếp",
          () => startLevel(level + 1),
        );
      } else {
        showOverlay(
          "Chiến thắng!",
          `Bạn hoàn thành tất cả ${LEVELS.length} màn với $${score}!`,
          "Chơi lại",
          () => startLevel(0),
        );
      }
    } else {
      showOverlay(
        "Thua rồi!",
        `Bạn chỉ kiếm được $${score}. Cần $${config.target} để qua màn.`,
        "Thử lại",
        () => startLevel(level),
      );
    }
  }

  function showOverlay(title, message, btnText, onClick) {
    overlayTitle.textContent = title;
    overlayMessage.textContent = message;
    overlayBtn.textContent = btnText;
    overlay.classList.remove("hidden");
    overlayBtn.onclick = onClick;
  }

  function togglePause() {
    if (gameState !== "playing" && gameState !== "paused") return;
    if (isPaused) {
      isPaused = false;
      gameState = "playing";
      pauseBtn.textContent = "⏸ Dừng";
      pauseBtn.classList.remove("paused");
      overlay.classList.add("hidden");
      startTimer();
    } else {
      isPaused = true;
      gameState = "paused";
      pauseBtn.textContent = "▶ Tiếp";
      pauseBtn.classList.add("paused");
      clearInterval(timerInterval);
      showOverlay(
        "Tạm dừng",
        "Trò chơi đang tạm dừng. Nhấn P hoặc nút Tiếp để tiếp tục.",
        "▶ Tiếp tục",
        togglePause,
      );
    }
  }

  function launchHook() {
    if (gameState !== "playing" || hookState !== "swinging") return;
    hookState = "extending";
  }

  function checkCollision(tip) {
    for (const item of items) {
      if (item.caught) continue;
      const dist = Math.hypot(tip.x - item.x, tip.y - item.y);
      if (dist < item.size / 2 + HOOK_RADIUS) {
        item.caught = true;
        caughtItem = item;
        return true;
      }
    }
    return false;
  }

  function update() {
    if (gameState !== "playing") return;
    updatePopups();

    if (hookState === "swinging") {
      hookLength = HOOK_REST_LENGTH;
      const limits = getSwingLimits(hookLength);
      swingAngle += getSwingSpeed() * swingDirection;
      if (swingAngle > limits.left) {
        swingAngle = limits.left;
        swingDirection = -1;
      } else if (swingAngle < limits.right) {
        swingAngle = limits.right;
        swingDirection = 1;
      }
    } else if (hookState === "extending") {
      hookLength += HOOK_EXTEND_SPEED;
      const tip = getHookTip();
      const maxLength = getMaxHookLength();
      const floorTipY = getFloorTipY();
      if (checkCollision(tip)) {
        hookState = "retracting";
      } else if (hookLength >= maxLength || tip.y >= floorTipY) {
        hookState = "retracting";
      }
    } else if (hookState === "retracting") {
      const speed = caughtItem
        ? HOOK_RETRACT_BASE / caughtItem.weight
        : HOOK_RETRACT_BASE * 1.5;
      hookLength -= speed;

      if (caughtItem) {
        const tip = getHookTip();
        caughtItem.x = tip.x;
        caughtItem.y = tip.y + caughtItem.size / 2;
      }

      if (hookLength <= HOOK_REST_LENGTH) {
        hookLength = HOOK_REST_LENGTH;
        if (caughtItem) {
          const def = ITEM_TYPES[caughtItem.type];
          if (def.penalty) {
            score = Math.max(-50, score + caughtItem.value);
            showScorePopup(caughtItem.x, caughtItem.y, caughtItem.value, true);
          } else {
            score += caughtItem.value;
            showScorePopup(caughtItem.x, caughtItem.y, caughtItem.value, false);
          }
          items = items.filter((i) => i !== caughtItem);
          caughtItem = null;
          updateHUD();
          checkLevelComplete();
        }
        if (gameState === "playing") hookState = "swinging";
      }
    }
  }

  // ── Score popups ─────────────────────────────────────────────────────────
  let scorePopups = [];

  function showScorePopup(x, y, value, isPenalty) {
    scorePopups.push({ x, y, value, isPenalty, life: 1.0 });
  }
  function updatePopups() {
    scorePopups = scorePopups.filter((p) => p.life > 0);
    scorePopups.forEach((p) => {
      p.life -= 0.025;
      p.y -= 1.2;
    });
  }
  function drawPopups() {
    scorePopups.forEach((p) => {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.font = "bold 18px sans-serif";
      ctx.textAlign = "center";
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.lineWidth = 3;
      const label = p.isPenalty ? `-$50 🍹` : `+$${p.value}`;
      ctx.fillStyle = p.isPenalty ? "#ff4757" : "#ffd700";
      ctx.strokeText(label, p.x, p.y);
      ctx.fillText(label, p.x, p.y);
      ctx.restore();
    });
  }

  // ── Drawing ───────────────────────────────────────────────────────────────
  function drawBackground() {
    const skyGrad = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
    skyGrad.addColorStop(0, "#e8a050");
    skyGrad.addColorStop(1, "#c47830");
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, CANVAS_WIDTH, GROUND_Y);

    const groundGrad = ctx.createLinearGradient(0, GROUND_Y, 0, CANVAS_HEIGHT);
    groundGrad.addColorStop(0, "#6b3a1f");
    groundGrad.addColorStop(0.3, "#4a2810");
    groundGrad.addColorStop(1, "#2d1808");
    ctx.fillStyle = groundGrad;
    ctx.fillRect(0, GROUND_Y, CANVAS_WIDTH, CANVAS_HEIGHT - GROUND_Y);

    ctx.fillStyle = "#3d2210";
    ctx.fillRect(0, GROUND_Y - 4, CANVAS_WIDTH, 8);
  }

  function drawMiner() {
    const minerImg = images.miner;
    if (!minerImg) return;
    const scale = CANVAS_WIDTH / minerImg.width;
    const drawH = minerImg.height * scale;
    ctx.drawImage(minerImg, 0, 0, CANVAS_WIDTH, Math.min(drawH, MINER_HEIGHT));
  }

  function drawHook() {
    const tip = getHookTip();

    ctx.strokeStyle = "#2a2a2a";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(pivotX, pivotY);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();

    ctx.fillStyle = "#555";
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#888";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(tip.x - 10, tip.y + 4);
    ctx.quadraticCurveTo(tip.x, tip.y + 18, tip.x + 10, tip.y + 4);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(tip.x - 8, tip.y + 10);
    ctx.lineTo(tip.x - 14, tip.y + 4);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(tip.x + 8, tip.y + 10);
    ctx.lineTo(tip.x + 14, tip.y + 4);
    ctx.stroke();
  }

  function drawItems() {
    for (const item of items) {
      const img = images[item.type];
      if (!img) continue;
      const half = item.size / 2;
      ctx.drawImage(img, item.x - half, item.y - half, item.size, item.size);

      if (!item.caught) {
        const def = ITEM_TYPES[item.type];
        let labelColor;
        if (def.penalty) labelColor = "rgba(255, 71, 87, 0.95)";
        else if (item.type === "diamond")
          labelColor = "rgba(100, 220, 255, 0.95)";
        else if (item.type === "ruby") labelColor = "rgba(255, 100, 130, 0.95)";
        else labelColor = "rgba(255, 215, 0, 0.85)";

        ctx.fillStyle = labelColor;
        ctx.font = "bold 11px sans-serif";
        ctx.textAlign = "center";
        const label = def.penalty ? `-$50` : `$${item.value}`;
        ctx.fillText(label, item.x, item.y + half + 14);
      }
    }
  }

  function draw() {
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    drawBackground();
    drawItems();
    drawMiner();
    drawHook();
    drawPopups();
  }

  function gameLoop(timestamp) {
    if (!lastTime) lastTime = timestamp;
    if (!isPaused) update();
    draw();
    lastTime = timestamp;
    animFrame = requestAnimationFrame(gameLoop);
  }

  function init() {
    // Mouse click
    canvas.addEventListener("click", launchHook);

    // Touch support — tap anywhere on canvas to launch hook
    canvas.addEventListener(
      "touchstart",
      (e) => {
        e.preventDefault(); // prevent double-fire with click
        launchHook();
      },
      { passive: false },
    );

    // Keyboard
    document.addEventListener("keydown", (e) => {
      if (e.code === "Space") {
        e.preventDefault();
        launchHook();
      }
      if (e.code === "KeyP") {
        e.preventDefault();
        togglePause();
      }
    });

    pauseBtn.addEventListener("click", togglePause);
    overlayBtn.onclick = () => startLevel(0);

    Promise.all([
      loadImage("miner", "assets/miner.png"),
      loadImage("diamond", "assets/diamond.png"),
      loadImage("ruby", "assets/ruby.png"),
      loadImage("gold", "assets/gold.png"),
      loadImage("rock", "assets/rock.png"),
      loadImage("durian", "assets/durian.png"),
    ])
      .then(() => {
        showOverlay(
          "Đào Anh Yêu",
          "50 màn chơi — móc đung đưa nhanh hơn mỗi màn.",
          "Bắt đầu",
          () => startLevel(0),
        );
        animFrame = requestAnimationFrame(gameLoop);
      })
      .catch(() => {
        overlayMessage.textContent =
          "Không thể tải hình ảnh. Kiểm tra thư mục assets.";
        overlay.classList.remove("hidden");
      });
  }

  init();
})();
