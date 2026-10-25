import type { Occasion } from '@ergon/core';
import type { CompletionEffect } from './effects';
import { thud } from './sound';

const SLAM_MS = 150;
const HOLD_MS = 700;
const FADE_MS = 250;
const EDGE = 12;

const SIZE: Record<Occasion, number> = { todo: 24, section: 30, column: 38 };
const WORDS: Record<Occasion, string> = { todo: 'Done', section: 'All done', column: 'All done' };

/** "DONE" slams down on the todo, and a ring spreads from the impact. */
export const stamp: CompletionEffect = async (
  element,
  rect,
  { layer, signal, occasion, sound, haptic },
) => {
  const tilt = (Math.random() < 0.5 ? -1 : 1) * (3 + Math.random() * 5);
  const created: HTMLElement[] = [];
  const animations: Animation[] = [];
  const add = (className: string) => {
    const el = document.createElement('div');
    el.className = className;
    layer.append(el);
    created.push(el);
    return el;
  };
  const play = async (el: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) => {
    const animation = el.animate(keyframes, options);
    animations.push(animation);
    await animation.finished.catch(() => undefined);
  };

  const mark = add('effect-stamp');
  mark.textContent = WORDS[occasion];
  mark.style.fontSize = `${SIZE[occasion]}px`;
  const { offsetWidth: width, offsetHeight: height } = mark;
  const x = Math.min(
    Math.max(rect.left + rect.width / 2, width / 2 + EDGE),
    innerWidth - width / 2 - EDGE,
  );
  const y = rect.top + rect.height / 2;
  mark.style.left = `${x}px`;
  mark.style.top = `${y}px`;
  const rest = `rotate(${tilt}deg)`;

  const cleanUp = () => {
    animations.forEach((animation) => animation.cancel());
    created.forEach((el) => el.remove());
  };
  signal.addEventListener('abort', cleanUp);
  try {
    await play(
      mark,
      [
        { transform: `scale(2.6) rotate(${tilt * 3}deg)`, opacity: 0 },
        { transform: `scale(1.15) rotate(${tilt}deg)`, opacity: 1, offset: 0.7 },
        { transform: `scale(1) ${rest}`, opacity: 1 },
      ],
      { duration: SLAM_MS, easing: 'cubic-bezier(.6,0,.9,.5)', fill: 'forwards' },
    );
    if (signal.aborted) return;

    haptic('impact');
    if (sound) thud();
    const wave = add('effect-stamp-wave');
    Object.assign(wave.style, {
      left: `${x}px`,
      top: `${y}px`,
      width: `${width}px`,
      height: `${height}px`,
      rotate: `${tilt}deg`,
    });
    void play(
      wave,
      [
        { outlineOffset: '0px', opacity: 0.9 },
        { outlineOffset: '28px', opacity: 0 },
      ],
      { duration: 500, easing: 'cubic-bezier(.2,.8,.2,1)' },
    );

    await new Promise((resolve) => {
      setTimeout(resolve, HOLD_MS);
      signal.addEventListener('abort', resolve);
    });
    if (signal.aborted) return;
    await play(mark, [{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, fill: 'forwards' });
  } finally {
    signal.removeEventListener('abort', cleanUp);
    cleanUp();
  }
};
