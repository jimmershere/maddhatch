(function () {
  function hasSubmitAccess(user) {
    if (!user || !Array.isArray(user.groups)) {
      return false;
    }
    return user.groups.some((group) => {
      if (!group) return false;
      const normalized = String(group).toLowerCase();
      return normalized === 'submit' || normalized === 'admin';
    });
  }

  function updatePanels(user) {
    const canSubmit = hasSubmitAccess(user);
    document.querySelectorAll('[data-support-internal]').forEach((el) => {
      el.hidden = !canSubmit;
    });
    document.querySelectorAll('[data-support-view-only]').forEach((el) => {
      el.hidden = canSubmit;
    });
  }

  function updateStatus(el, message, variant) {
    if (!el) return;
    el.textContent = message || '';
    el.hidden = !message;
    el.classList.remove('status-success', 'status-error', 'status-info');
    if (message && variant) {
      el.classList.add('status-' + variant);
    }
  }

  function setIfEmpty(field, value) {
    if (field && !field.value && value) {
      field.value = value;
    }
  }

  function prefillFromUser(user) {
    if (!user) return;
    const form = document.querySelector('[data-support-request-form]');
    if (!form) return;
    const userField = form.querySelector('[name="user_id"]');
    const emailField = form.querySelector('[name="email"]');
    const phoneField = form.querySelector('[name="phone"]');
    setIfEmpty(userField, user.username);
    setIfEmpty(emailField, user.email);
    setIfEmpty(phoneField, user.phone);
  }

  async function submitRequest(event) {
    event.preventDefault();
    const form = event.target;
    const statusEl = document.querySelector('[data-support-request-status]');
    const formData = new FormData(form);
    const payload = {
      user_id: String(formData.get('user_id') || '').trim(),
      email: String(formData.get('email') || '').trim(),
      phone: String(formData.get('phone') || '').trim(),
      description: String(formData.get('description') || '').trim()
    };

    if (!payload.user_id || !payload.email || !payload.phone || !payload.description) {
      updateStatus(statusEl, 'All fields are required to log a support request.', 'error');
      return;
    }

    updateStatus(statusEl, 'Submitting support request…', 'info');

    try {
      const res = await fetch('/support/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = data.error || data.message || 'Request failed.';
        throw new Error(message);
      }
      updateStatus(statusEl, `Request ${data.request_number} logged. We will reach out shortly.`, 'success');
      form.reset();
      prefillFromUser(window.MADDH_USER);
    } catch (err) {
      updateStatus(statusEl, err.message, 'error');
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    updatePanels(window.MADDH_USER);
    prefillFromUser(window.MADDH_USER);

    const form = document.querySelector('[data-support-request-form]');
    if (form) {
      form.addEventListener('submit', submitRequest);
    }
  });

  window.addEventListener('maddh-auth-ready', (event) => {
    const user = event.detail || window.MADDH_USER;
    updatePanels(user);
    prefillFromUser(user);
  });
})();
