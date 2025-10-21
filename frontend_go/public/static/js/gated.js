(function () {
  function toggleGatedContent(user) {
    const gatedSections = document.querySelectorAll('[data-gated-content]');
    const overlay = document.querySelector('[data-login-overlay]');
    const isAuthed = !!(user && (user.username || user.display_name));

    gatedSections.forEach((section) => {
      if (isAuthed) {
        section.classList.remove('is-gated');
        section.removeAttribute('aria-hidden');
      } else {
        section.classList.add('is-gated');
        section.setAttribute('aria-hidden', 'true');
      }
    });

    if (overlay) {
      overlay.hidden = isAuthed;
    }
  }

  window.addEventListener('maddh-auth-ready', (event) => {
    toggleGatedContent(event.detail || window.MADDH_USER);
  });

  window.addEventListener('DOMContentLoaded', () => {
    toggleGatedContent(window.MADDH_USER);
  });
})();
