(() => {
  const canvas = document.getElementById('particles');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const settingsView = document.getElementById('settings-view');

  let width = 0, height = 0, dpr = 1;
  let particles = [];
  let speedLines = [];
  let mouse = { x: -9999, y: -9999 };
  let running = true;

  const COLORS = ['#6c8cff', '#a06cff', '#5b8cff', '#8f7bff', '#3ddc97'];
  const LINK_DIST = 130;
  const MOUSE_RADIUS = 160;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    spawn();
  }

  function spawn() {
    const count = Math.min(110, Math.floor((width * height) / 16000));
    particles = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.45,
      vy: (Math.random() - 0.5) * 0.45,
      r: Math.random() * 1.8 + 0.8,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    }));
  }

  function spawnSpeedLine() {
    const fromLeft = Math.random() > 0.5;
    const y = Math.random() * height;
    const len = 60 + Math.random() * 140;
    speedLines.push({
      x: fromLeft ? -len : width + len,
      y,
      len,
      speed: 6 + Math.random() * 10,
      alpha: 0.05 + Math.random() * 0.12,
      fromLeft,
    });
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);

    // 柔和光晕背景
    const glow = ctx.createRadialGradient(width * 0.5, height * 0.4, 0, width * 0.5, height * 0.4, Math.max(width, height) * 0.55);
    glow.addColorStop(0, 'rgba(91,140,255,0.07)');
    glow.addColorStop(1, 'rgba(160,108,255,0.02)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    // 连线
    ctx.lineWidth = 1;
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const a = particles[i], b = particles[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const dist = Math.hypot(dx, dy);
        if (dist < LINK_DIST) {
          ctx.strokeStyle = `rgba(120,140,255,${(1 - dist / LINK_DIST) * 0.35})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }

    // 粒子
    for (const p of particles) {
      // 鼠标斥力
      const mdx = p.x - mouse.x, mdy = p.y - mouse.y;
      const mdist = Math.hypot(mdx, mdy);
      if (mdist < MOUSE_RADIUS && mdist > 0.01) {
        const force = (1 - mdist / MOUSE_RADIUS) * 0.6;
        p.x += (mdx / mdist) * force;
        p.y += (mdy / mdist) * force;
      }

      p.x += p.vx;
      p.y += p.vy;

      if (p.x < -20) p.x = width + 20;
      if (p.x > width + 20) p.x = -20;
      if (p.y < -20) p.y = height + 20;
      if (p.y > height + 20) p.y = -20;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = 0.7;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // 速度线（赛车氛围）
    for (let i = speedLines.length - 1; i >= 0; i--) {
      const s = speedLines[i];
      s.x += s.fromLeft ? s.speed : -s.speed;
      ctx.strokeStyle = `rgba(140,160,255,${s.alpha})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (s.fromLeft) ctx.moveTo(s.x - s.len, s.y);
      else ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x + (s.fromLeft ? 0 : -s.len), s.y);
      ctx.stroke();
      if ((s.fromLeft && s.x > width + s.len) || (!s.fromLeft && s.x < -s.len)) {
        speedLines.splice(i, 1);
      }
    }
  }

  function loop() {
    if (running) {
      draw();
      if (Math.random() < 0.02 && speedLines.length < 14) spawnSpeedLine();
    }
    requestAnimationFrame(loop);
  }

  window.addEventListener('resize', resize);
  window.addEventListener('mousemove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  });
  window.addEventListener('mouseout', () => { mouse.x = -9999; mouse.y = -9999; });

  // 只在设置页可见时运行动画，节省性能
  const observer = new MutationObserver(() => {
    running = !settingsView.classList.contains('hidden');
  });
  observer.observe(settingsView, { attributes: true, attributeFilter: ['class'] });

  resize();
  loop();
})();
