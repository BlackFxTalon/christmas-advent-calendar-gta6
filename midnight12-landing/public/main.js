const menuButton = document.querySelector('.menu-toggle');
const navigation = document.querySelector('#main-nav');
const dialog = document.querySelector('#notice-dialog');
const noticeMessage = document.querySelector('#notice-message');

menuButton?.addEventListener('click', () => {
  const expanded = menuButton.getAttribute('aria-expanded') === 'true';
  menuButton.setAttribute('aria-expanded', String(!expanded));
  navigation?.classList.toggle('is-open', !expanded);
});

navigation?.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => {
    navigation.classList.remove('is-open');
    menuButton?.setAttribute('aria-expanded', 'false');
  });
});

document.querySelectorAll('[data-placeholder]').forEach((button) => {
  button.addEventListener('click', (event) => {
    event.preventDefault();
    if (!dialog || !noticeMessage) return;
    noticeMessage.textContent = button.dataset.placeholder || 'Функция появится перед запуском.';
    dialog.showModal();
  });
});

dialog?.querySelector('.notice__close')?.addEventListener('click', () => dialog.close());
dialog?.querySelector('.notice__ok')?.addEventListener('click', () => dialog.close());
dialog?.addEventListener('click', (event) => {
  if (event.target === dialog) dialog.close();
});

const countdown = document.querySelector('#countdown-value');
const launchDate = new Date('2026-12-20T09:00:00+03:00');
const updateCountdown = () => {
  if (!countdown) return;
  const diff = launchDate.getTime() - Date.now();
  if (diff <= 0) {
    countdown.textContent = 'Дело открыто';
    return;
  }
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  countdown.textContent = days > 0 ? `${days} ${days === 1 ? 'день' : days < 5 ? 'дня' : 'дней'}` : `${hours} ч`;
};
updateCountdown();
setInterval(updateCountdown, 60_000);


const trailerVideo = document.querySelector('.trailer__video');
if (trailerVideo) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const syncTrailerPlayback = () => {
    if (reduceMotion.matches || document.hidden) {
      trailerVideo.pause();
      return;
    }
    trailerVideo.play().catch(() => {});
  };
  syncTrailerPlayback();
  document.addEventListener('visibilitychange', syncTrailerPlayback);
  reduceMotion.addEventListener?.('change', syncTrailerPlayback);
}
