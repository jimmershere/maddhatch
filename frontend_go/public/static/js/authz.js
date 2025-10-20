(function () {
  function normalizeRoles(value) {
    if (!value) return [];
    return value
      .split(',')
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean);
  }

  function hasRole(user, role) {
    if (!user || !user.groups) return false;
    return user.groups.some((g) => g.toLowerCase() === role.toLowerCase());
  }

  function applyAuthorization(user) {
    document.querySelectorAll('[data-requires-role]').forEach((el) => {
      const required = normalizeRoles(el.getAttribute('data-requires-role'));
      const allowed = required.every((role) => hasRole(user, role));
      if (!allowed) {
        el.classList.add('is-disabled');
        el.setAttribute('aria-disabled', 'true');
        if ('disabled' in el) {
          el.disabled = true;
        }
      } else {
        el.classList.remove('is-disabled');
        el.removeAttribute('aria-disabled');
        if ('disabled' in el) {
          el.disabled = false;
        }
      }
    });
  }

  window.addEventListener('maddh-auth-ready', (event) => {
    applyAuthorization(event.detail || window.MADDH_USER);
  });
})();
