const layers = new WeakMap();
const presets = {
  dust: { count: 12, color: '#d4bea0', speed: .55, gravity: .2 },
  sparks: { count: 19, color: '#ffa044', speed: 1.2, gravity: .75 },
  slime: { count: 15, color: '#88e342', speed: .37, gravity: 1.25 },
  shards: { count: 15, color: '#9adfff', speed: 1.15, gravity: .6 },
  drops: { count: 11, color: '#a9ff66', speed: .85, gravity: 1.15 },
};

function paint(layer, now) {
  const { canvas, ctx, view } = layer;
  const scale = Math.min(view.devicePixelRatio || 1, 1.5);
  const width = Math.ceil(view.innerWidth * scale);
  const height = Math.ceil(view.innerHeight * scale);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, view.innerWidth, view.innerHeight);
  layer.bursts = layer.bursts.filter(({ end }) => now < end);
  for (const burst of layer.bursts) drawBurst(ctx, burst, now);
  if (layer.bursts.length) layer.frame = view.requestAnimationFrame((time) => paint(layer, time));
  else clearParticles(canvas.ownerDocument);
}

function drawBurst(ctx, burst, now) {
  const { kind, x, y, start, end, size, color, particles } = burst;
  if (now < start) return;
  const t = (now - start) / (end - start);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  if (kind === 'dust') {
    ctx.globalAlpha = .62 * (1 - t) ** 2;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.ellipse(x, y, size * (.15 + t * .59), size * (.03 + t * .14), 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (const { vx, vy, radius, gravity } of particles) {
    const dx = x + vx * t;
    const dy = y + vy * t + gravity * t * t;
    ctx.globalAlpha = (1 - t) * .85;
    ctx.beginPath();
    if (kind === 'shards') {
      ctx.moveTo(dx - radius, dy);
      ctx.lineTo(dx + radius, dy - radius * 2);
      ctx.lineTo(dx + radius * .25, dy + radius);
      ctx.closePath();
    } else {
      ctx.ellipse(dx, dy, radius, kind === 'slime' ? radius * (1 + 2 * t) : radius, 0, 0, Math.PI * 2);
    }
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export function clearParticles(doc) {
  const layer = layers.get(doc);
  if (!layer) return;
  layer.view.cancelAnimationFrame(layer.frame);
  layer.canvas.remove();
  layers.delete(doc);
}

export function burstParticles(doc, kind, x, y, size, duration, delay = 0) {
  const view = doc.defaultView;
  if (!duration || doc.hidden || !view?.requestAnimationFrame) return;
  let layer = layers.get(doc);
  if (!layer) {
    const canvas = doc.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.className = 'motion-overlay motion-particles';
    canvas.setAttribute('aria-hidden', 'true');
    doc.body.append(canvas);
    layer = { canvas, ctx, view, bursts: [] };
    layers.set(doc, layer);
    layer.frame = view.requestAnimationFrame((time) => paint(layer, time));
  }

  const { count, color, speed, gravity } = presets[kind];
  const distance = Math.max(20, Math.min(size, 88));
  const start = view.performance.now() + delay;
  const particles = Array.from({ length: count }, () => {
    const angle = Math.random() * Math.PI * 2;
    const velocity = distance * speed * (.35 + Math.random() * .65);
    const dy = Math.sin(angle) * velocity;
    return {
      vx: Math.cos(angle) * velocity,
      vy: kind === 'drops' ? -Math.abs(dy) : dy,
      radius: .9 + Math.random() * 1.8,
      gravity: gravity * distance,
    };
  });
  if (layer.bursts.length >= 6) layer.bursts.shift();
  layer.bursts.push({ kind, x, y, size: distance, start, end: start + duration, color, particles });
}
