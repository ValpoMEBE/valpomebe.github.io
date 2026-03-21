// ── Mobile nav toggle ─────────────────────────────────────────
const navToggle = document.querySelector('.nav-toggle');
const siteNav   = document.querySelector('.site-nav');

if (navToggle && siteNav) {
  navToggle.addEventListener('click', () => {
    siteNav.classList.toggle('open');
    navToggle.classList.toggle('open');
  });
}
