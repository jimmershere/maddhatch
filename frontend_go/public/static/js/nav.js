(function () {
  function getDropdown(element) {
    return element.closest('[data-nav-dropdown]');
  }

  function setDropdownState(dropdown, isOpen) {
    if (!dropdown) return;
    const toggle = dropdown.querySelector('[data-nav-toggle]');
    if (isOpen) {
      dropdown.classList.add('is-open');
    } else {
      dropdown.classList.remove('is-open');
    }
    if (toggle) {
      toggle.setAttribute('aria-expanded', String(!!isOpen));
    }
  }

  function closeAllDropdowns(except) {
    document.querySelectorAll('[data-nav-dropdown]').forEach((dropdown) => {
      if (dropdown === except) return;
      setDropdownState(dropdown, false);
    });
  }

  function handleToggleClick(event) {
    const toggle = event.target.closest('[data-nav-toggle]');
    if (!toggle) return;
    event.preventDefault();
    const dropdown = getDropdown(toggle);
    const isOpen = dropdown && dropdown.classList.contains('is-open');
    closeAllDropdowns(dropdown);
    setDropdownState(dropdown, !isOpen);
  }

  function applyAuthState(user) {
    const isAuthed = !!(user && (user.username || user.display_name));
    document.querySelectorAll('[data-nav-auth="login"]').forEach((el) => {
      el.hidden = isAuthed;
    });
    document.querySelectorAll('[data-nav-auth="logout"]').forEach((el) => {
      el.hidden = !isAuthed;
    });
  }

  window.addEventListener('DOMContentLoaded', () => {
    document.addEventListener('click', (event) => {
      if (event.target.closest('[data-nav-toggle]')) {
        handleToggleClick(event);
        return;
      }

      if (event.target.closest('[data-nav-menu]')) {
        return;
      }

      closeAllDropdowns();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeAllDropdowns();
      }
    });

    applyAuthState(window.MADDH_USER);
  });

  window.addEventListener('maddh-auth-ready', (event) => {
    applyAuthState(event.detail || window.MADDH_USER);
  });
})();
