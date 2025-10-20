(function () {
  const config = window.MADDH_CONFIG || {};
  const loginStart = window.MADDH_OAUTH2_START || config.oauthStart || '/oauth2/start';

  function updateLoginLinks() {
    document.querySelectorAll('[data-login-link]').forEach((el) => {
      const desired = el.getAttribute('data-login-target');
      const redirect = desired && desired.length ? desired : window.location.pathname + window.location.search;
      const target = loginStart + '?rd=' + encodeURIComponent(redirect);
      el.setAttribute('href', target);
    });
  }

  async function fetchUserInfo() {
    try {
      const res = await fetch('/oauth2/userinfo', { credentials: 'include' });
      if (!res.ok) {
        window.MADDH_USER = null;
        return;
      }
      const data = await res.json();
      window.MADDH_USER = data;
      const badge = document.querySelector('[data-user-name]');
      if (badge) {
        badge.textContent = data.display_name || data.username;
        badge.classList.add('is-authenticated');
      }
    } catch (err) {
      console.warn('userinfo fetch failed', err);
      window.MADDH_USER = null;
    }
  }

  window.addEventListener('DOMContentLoaded', async () => {
    updateLoginLinks();
    await fetchUserInfo();
    window.dispatchEvent(new CustomEvent('maddh-auth-ready', { detail: window.MADDH_USER }));
  });
})();
