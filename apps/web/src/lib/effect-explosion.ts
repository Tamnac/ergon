import type { Occasion } from '@ergon/core';
import type { CompletionEffect } from './effects';
import { thud } from './sound';

/** How far sparks fly, in px. */
const REACH: Record<Occasion, number> = { todo: 110, section: 160, column: 230 };
const COUNT: Record<Occasion, number> = { todo: 60, section: 100, column: 160 };
/** Sparks alive across all running explosions, so bulk completions stay smooth. */
const MAX_PARTICLES = 300;
const LIFE = 0.8;
const DRAG = 3;
const GRAVITY = 500;
/** Sparks leave from the middle of the text, however long it is. */
const SOURCE_WIDTH = 240;

let alive = 0;

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  width: number;
  color: string;
}

const random = (min: number, max: number) => min + Math.random() * (max - min);

/** A flash, then sparks fly off the text and fall. */
export const explosion: CompletionEffect = async (
  _element,
  rect,
  { layer, signal, occasion, sound, haptic },
) => {
  const reach = REACH[occasion];
  const margin = reach + 120;
  const style = getComputedStyle(document.documentElement);
  const palette = [
    style.getPropertyValue('--accent'),
    style.getPropertyValue('--accent'),
    style.getPropertyValue('--ring-c2'),
    style.getPropertyValue('--fg'),
  ];
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const sourceWidth = Math.min(rect.width, SOURCE_WIDTH);

  const flash = document.createElement('div');
  flash.className = 'effect-flash';
  Object.assign(flash.style, {
    left: `${centerX}px`,
    top: `${centerY}px`,
    width: `${reach * 2}px`,
    height: `${reach * 2}px`,
  });

  const canvas = document.createElement('canvas');
  const width = sourceWidth + margin * 2;
  const height = rect.height + margin * 2;
  const scale = devicePixelRatio;
  canvas.width = width * scale;
  canvas.height = height * scale;
  Object.assign(canvas.style, {
    position: 'fixed',
    left: `${centerX - width / 2}px`,
    top: `${centerY - height / 2}px`,
    width: `${width}px`,
    height: `${height}px`,
  });
  const context = canvas.getContext('2d')!;
  context.scale(scale, scale);
  context.lineCap = 'round';

  const sparks: Spark[] = Array.from(
    { length: Math.min(COUNT[occasion], MAX_PARTICLES - alive) },
    () => {
      const life = LIFE * random(0.6, 1);
      const angle = random(0, Math.PI * 2);
      const speed = (reach * DRAG * random(0.3, 1)) / (1 - Math.exp(-DRAG * life));
      return {
        x: width / 2 + random(-sourceWidth / 2, sourceWidth / 2),
        y: height / 2 + random(-rect.height / 4, rect.height / 4),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 80,
        age: 0,
        life,
        width: random(2, 4.5),
        color: palette[Math.floor(Math.random() * palette.length)]!,
      };
    },
  );
  alive += sparks.length;
  layer.append(flash, canvas);
  const flashing = flash.animate(
    [
      { transform: 'scale(0.1)', opacity: 1 },
      { transform: 'scale(1)', opacity: 0 },
    ],
    { duration: 350, easing: 'cubic-bezier(.1,.7,.2,1)', fill: 'forwards' },
  );
  haptic('impact');
  if (sound) thud();

  let frame = 0;
  const cleanUp = () => {
    cancelAnimationFrame(frame);
    flashing.cancel();
    flash.remove();
    canvas.remove();
  };
  try {
    await new Promise<void>((resolve) => {
      signal.addEventListener('abort', () => resolve());
      let last = performance.now();
      const step = (now: number) => {
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        context.clearRect(0, 0, width, height);
        for (const spark of sparks) {
          spark.age += dt;
          spark.vx *= Math.exp(-DRAG * dt);
          spark.vy = spark.vy * Math.exp(-DRAG * dt) + GRAVITY * dt;
          spark.x += spark.vx * dt;
          spark.y += spark.vy * dt;
          const left = Math.max(0, 1 - spark.age / spark.life);
          context.globalAlpha = left ** 1.5;
          context.strokeStyle = spark.color;
          context.lineWidth = spark.width * (0.5 + left / 2);
          context.beginPath();
          context.moveTo(spark.x, spark.y);
          context.lineTo(spark.x - spark.vx * 0.03, spark.y - spark.vy * 0.03);
          context.stroke();
        }
        if (sparks.every((spark) => spark.age >= spark.life)) resolve();
        else frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    });
  } finally {
    alive -= sparks.length;
    cleanUp();
  }
};
