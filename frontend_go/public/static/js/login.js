(function () {
  const config = window.MADDH_CONFIG || {};
  const loginStart = window.MADDH_OAUTH2_START || config.oauthStart || '/oauth2/start';

  function updateStatus(el, message, variant) {
    if (!el) return;
    el.textContent = message;
    el.classList.remove('status-success', 'status-error', 'status-info');
    if (variant) {
      el.classList.add('status-' + variant);
    }
    el.hidden = !message;
  }

  async function postJSON(url, payload) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload)
    });
    let data = {};
    try {
      data = await res.json();
    } catch (err) {
      data = {};
    }
    if (!res.ok) {
      const msg = data.error || data.message || 'Request failed.';
      throw new Error(msg);
    }
    return data;
  }

  function handleTokenConfirmation(messageEl, token) {
    if (!token) return;
    updateStatus(messageEl, 'Checking your confirmation link…', 'info');
    postJSON('/auth/register/confirm', { token })
      .then((data) => {
        updateStatus(messageEl, data.message || 'Your account is active. You can log in now.', 'success');
        const params = new URLSearchParams(window.location.search);
        params.delete('token');
        const url = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
        window.history.replaceState({}, document.title, url);
      })
      .catch((err) => {
        updateStatus(messageEl, err.message, 'error');
      });
  }

  function buildLoginUrl(targetPath) {
    const redirect = targetPath.startsWith('/') ? targetPath : '/' + targetPath;
    return loginStart + '?rd=' + encodeURIComponent(redirect);
  }

  window.addEventListener('DOMContentLoaded', () => {
    const loginStatus = document.querySelector('[data-login-status]');
    document.querySelectorAll('[data-login-button]').forEach((button) => {
      const targetPath = button.getAttribute('data-login-target') || '/order.html';
      const label = button.getAttribute('data-login-label') || 'secure portal';
      button.addEventListener('click', () => {
        updateStatus(loginStatus, `Redirecting to the ${label}…`, 'info');
        window.location.href = buildLoginUrl(targetPath);
      });
    });

    document.querySelectorAll('[data-login-link]').forEach((link) => {
      const targetPath = link.getAttribute('data-login-target') || '/order.html';
      link.setAttribute('href', buildLoginUrl(targetPath));
      if (!link.getAttribute('target')) {
        link.setAttribute('target', '_blank');
      }
      link.setAttribute('rel', 'noopener');
    });

    const form = document.querySelector('[data-registration-form]');
    const messageEl = document.querySelector('[data-registration-message]');
    if (form) {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const formData = new FormData(form);
        const payload = {
          email: String(formData.get('email') || '').trim(),
          username: String(formData.get('username') || '').trim(),
          password: String(formData.get('password') || '').trim(),
          display_name: String(formData.get('display_name') || '').trim() || undefined
        };
        if (!payload.email || !payload.username || !payload.password) {
          updateStatus(messageEl, 'Email, account name, and password are required.', 'error');
          return;
        }
        updateStatus(messageEl, 'Sending confirmation email…', 'info');
        try {
          const data = await postJSON('/auth/register', payload);
          updateStatus(messageEl, data.message || 'Check your email for the confirmation link.', 'success');
          form.reset();
        } catch (err) {
          updateStatus(messageEl, err.message, 'error');
        }
      });
    }

    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (token) {
      handleTokenConfirmation(messageEl || loginStatus, token);
    }
  });
})();
