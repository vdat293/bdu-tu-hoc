import { useEffect, useRef } from 'react';
import { getFrameCinematicMetadata } from './Identity.jsx';

const INTRO_EFFECTS = [
  'constellation-forge', 'binary-eclipse', 'triad-supernova', 'orbit-lock',
  'dragon-awaken', 'crystal-wings', 'mecha-assemble', 'phoenix-rise',
  'runner-up-dual', 'blade-cross', 'elite-pulse', 'th-quantum-compile',
  'th-dual-synapse', 'th-ternary-boot', 'th-protocol-lock',
  'gojo-limitless-awaken', 'itachi-crow-genjutsu', 'aidti-data-awaken'
];
const INTRO_DURATION_MS = 2800;

function removeEffectClasses(element) {
  if (!element) return;
  element.classList.remove(...INTRO_EFFECTS.map((effect) => `frame-effect-${effect}`));
}

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function particleCount(frame, width) {
  if (frame.family === 'aidti-bdu') return width <= 480 ? 12 : 18;
  if (frame.family?.startsWith('anime-')) return width <= 480 ? 29 : 46;
  if (frame.family === 'khoa-th') {
    const count = frame.rank === 1 ? 42 : frame.rank === 2 ? 34 : frame.rank === 3 ? 28 : 18;
    return width <= 480 ? Math.ceil(count * .62) : count;
  }
  if (frame.scope === 'truong') {
    const count = frame.rank === 1 ? 64 : frame.rank === 2 ? 50 : frame.rank === 3 ? 44 : 30;
    return width <= 480 ? Math.ceil(count * .62) : count;
  }
  return width <= 480 ? 24 : 38;
}

function particleKind(frame, index) {
  if (frame.family === 'aidti-bdu') return index % 4 === 0 ? 'star' : 'spark';
  if (frame.family === 'anime-itachi') return index % 3 === 0 ? 'shard' : 'spark';
  if (frame.family === 'anime-gojo') return index % 2 === 0 ? 'star' : 'spark';
  if (frame.family === 'khoa-th') return index % 4 === 0 ? 'shard' : 'spark';
  if (frame.introEffect === 'constellation-forge') return index % 3 === 0 ? 'star' : index % 7 === 0 ? 'shard' : 'spark';
  if (frame.introEffect === 'triad-supernova') return index % 2 === 0 ? 'shard' : 'star';
  return index % 5 === 0 ? 'shard' : index % 3 === 0 ? 'star' : 'spark';
}

function createParticles(field, frame) {
  if (!field || prefersReducedMotion()) return;
  const count = particleCount(frame, window.innerWidth || 1024);
  const fragment = document.createDocumentFragment();
  const isAidti = frame.family === 'aidti-bdu';
  for (let index = 0; index < count; index += 1) {
    const angle = (Math.PI * 2 * index / count) + ((Math.random() - 0.5) * 0.34);
    const prestigeDistance = frame.scope === 'truong' && frame.rank <= 3 ? (4 - frame.rank) * 18 : 0;
    const distance = isAidti ? 64 + Math.random() * 54 : 82 + prestigeDistance + Math.random() * 105;
    const particle = document.createElement('i');
    particle.className = `frame-particle frame-particle-${particleKind(frame, index)}`;
    particle.style.setProperty('--particle-x', `${Math.cos(angle) * distance}px`);
    particle.style.setProperty('--particle-y', `${Math.sin(angle) * distance}px`);
    particle.style.setProperty('--particle-delay', `${isAidti ? 180 + Math.random() * 520 : 80 + Math.random() * 300}ms`);
    particle.style.setProperty('--particle-duration', `${isAidti ? 1500 + Math.random() * 900 : 680 + Math.random() * 620}ms`);
    particle.style.setProperty('--particle-size', `${isAidti ? 1.5 + Math.random() * 2.5 : 2 + Math.random() * 5}px`);
    particle.style.setProperty('--particle-spin', `${isAidti ? 20 + Math.random() * 80 : 180 + Math.random() * 540}deg`);
    fragment.appendChild(particle);
  }
  field.replaceChildren(fragment);
}

/** Replays the legacy frame opening timeline after React has committed artwork. */
export function useFrameCinematic({ frame, avatarRef, bannerRef, announcementRef, particleFieldRef }) {
  const timerRef = useRef(null);
  const frameRef = useRef(frame);
  frameRef.current = frame;

  useEffect(() => {
    const avatar = avatarRef.current;
    const banner = bannerRef.current;
    const announcement = announcementRef.current;
    const field = particleFieldRef.current;
    const metadata = getFrameCinematicMetadata(frameRef.current);
    if (!avatar || !banner || !metadata) return undefined;

    const effectClass = `frame-effect-${metadata.introEffect}`;
    removeEffectClasses(avatar);
    removeEffectClasses(banner);
    avatar.classList.add(effectClass);
    banner.classList.add(effectClass);
    [avatar, banner, announcement].filter(Boolean).forEach((element) => {
      element.style.setProperty('--frame-primary', metadata.theme.primary);
      element.style.setProperty('--frame-secondary', metadata.theme.secondary);
      element.style.setProperty('--frame-highlight', metadata.theme.highlight);
      element.style.setProperty('--frame-rgb', metadata.theme.rgb);
    });
    announcement?.classList.add('is-persistent');
    createParticles(field, metadata);

    window.clearTimeout(timerRef.current);
    avatar.classList.remove('frame-intro-burst');
    banner.classList.remove('frame-cinematic-active');
    announcement?.classList.remove('is-revealing');

    if (prefersReducedMotion()) {
      removeEffectClasses(avatar);
      removeEffectClasses(banner);
    } else {
      void avatar.offsetWidth;
      avatar.classList.add('frame-intro-burst');
      banner.classList.add('frame-cinematic-active');
      announcement?.classList.add('is-revealing');
      timerRef.current = window.setTimeout(() => {
        avatar.classList.remove('frame-intro-burst');
        banner.classList.remove('frame-cinematic-active');
        announcement?.classList.remove('is-revealing');
        removeEffectClasses(avatar);
        removeEffectClasses(banner);
        timerRef.current = null;
      }, INTRO_DURATION_MS);
    }

    return () => {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
      avatar.classList.remove('frame-intro-burst');
      banner.classList.remove('frame-cinematic-active');
      announcement?.classList.remove('is-revealing', 'is-persistent');
      removeEffectClasses(avatar);
      removeEffectClasses(banner);
      [avatar, banner, announcement].filter(Boolean).forEach((element) => {
        ['--frame-primary', '--frame-secondary', '--frame-highlight', '--frame-rgb'].forEach((property) => element.style.removeProperty(property));
      });
      field?.replaceChildren();
    };
  }, [announcementRef, avatarRef, bannerRef, frame?.key, frame?.introEffect, frame?.themeKey, particleFieldRef]);
}
