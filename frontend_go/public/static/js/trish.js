(function () {
  const support = window.MADDH_SUPPORT || {};
  const storeKey = 'Madd Hatchery Support Tickets';
  let widget, log, input, pendingTicket = null;

  function randomGreeting() {
    const greetings = (support.triage && support.triage.greetings) || [
      'Hi! Trish here. What can I help you with?'
    ];
    return greetings[Math.floor(Math.random() * greetings.length)];
  }

  function formatTime() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function addMessage(author, text, options = {}) {
    const bubble = document.createElement('div');
    bubble.className = 'trish-bubble ' + (author === 'trish' ? 'trish-agent' : 'trish-user');
    const body = document.createElement('div');
    body.className = 'trish-text';
    body.innerHTML = text;
    const meta = document.createElement('span');
    meta.className = 'trish-meta';
    meta.textContent = (author === 'trish' ? 'Trish' : 'You') + ' • ' + formatTime();
    bubble.appendChild(body);
    bubble.appendChild(meta);
    log.appendChild(bubble);
    log.scrollTop = log.scrollHeight;
    if (options.highlight) {
      bubble.classList.add('trish-highlight');
      setTimeout(() => bubble.classList.remove('trish-highlight'), 2500);
    }
  }

  function saveTicket(ticket) {
    const store = JSON.parse(localStorage.getItem(storeKey) || '[]');
    store.unshift(ticket);
    localStorage.setItem(storeKey, JSON.stringify(store.slice(0, 50)));
  }

  async function sendTicket(summary, severity) {
    const prefix = (support.triage && support.triage.ticketPrefix) || 'MHT-';
    const ticketId = `${prefix}${Date.now().toString(36).toUpperCase()}`;
    const user = window.MADDH_USER;
    const payload = {
      id: ticketId,
      summary,
      severity,
      user: user && user.username ? user.username : undefined
    };
    saveTicket({
      id: ticketId,
      summary,
      severity,
      timestamp: new Date().toISOString(),
      user: payload.user || null
    });
    try {
      await fetch('/support/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
      });
    } catch (err) {
      console.warn('ticket submission failed', err);
    }
    return ticketId;
  }

  function contactLinks() {
    const parts = [];
    if (support.email) {
      parts.push(`<a href="mailto:${support.email}">email ${support.email}</a>`);
    }
    if (support.sms) {
      parts.push(`<a href="sms:${support.sms}">text ${support.sms}</a>`);
    }
    if (support.phone) {
      parts.push(`<a href="tel:${support.phone}">call ${support.phone}</a>`);
    }
    return parts.join(' • ');
  }

  async function handleSeverity(message) {
    const severity = parseInt(message, 10);
    if (Number.isNaN(severity) || severity < 1 || severity > 4) {
      addMessage('trish', 'Severity should be 1 (urgent outage) through 4 (FYI). What severity fits this ticket?');
      return;
    }
    const ticketId = await sendTicket(pendingTicket.summary, severity);
    addMessage(
      'trish',
      `Ticket <strong>${ticketId}</strong> is logged with severity ${severity}. Ops has your details — you can also ${contactLinks()} if you need quicker escalation.`,
      { highlight: true }
    );
    pendingTicket = null;
  }

  async function handleMessage(message) {
    addMessage('user', message);
    if (pendingTicket) {
      await handleSeverity(message);
      return;
    }

    if (/(error|trouble|issue|broken|fail)/i.test(message)) {
      pendingTicket = { summary: message };
      const helpText = (support.triage && support.triage.severityHelp) || 'Tell me a severity from 1 (outage) to 4 (heads up).';
      addMessage('trish', `Thanks for flagging that. ${helpText}`);
      return;
    }

    addMessage(
      'trish',
      `Got it! If anything escalates, just say "trouble" and I’ll log a ticket. You can also ${contactLinks()}.`
    );
  }

  function createWidget() {
    widget = document.createElement('div');
    widget.className = 'trish-widget';
    widget.innerHTML = `
      <button type="button" class="trish-toggle" aria-expanded="false">💬 Trish</button>
      <div class="trish-panel" hidden>
        <div class="trish-header">
          <div class="trish-identity">
            <img src="/assets/trish.svg" alt="Trish, customer advocate" class="trish-avatar">
            <div>
              <strong>Trish — Customer Advocate</strong>
              <p>Live support ${support.escalationHours || ''}</p>
            </div>
          </div>
          <button type="button" class="trish-close" aria-label="Close">×</button>
        </div>
        <div class="trish-log"></div>
        <form class="trish-form">
          <label for="trish-input" class="sr-only">Message</label>
          <input id="trish-input" autocomplete="off" placeholder="Ask Trish anything…" required>
          <button type="submit">Send</button>
        </form>
      </div>
    `;
    document.body.appendChild(widget);
    log = widget.querySelector('.trish-log');
    input = widget.querySelector('#trish-input');

    const toggle = widget.querySelector('.trish-toggle');
    const panel = widget.querySelector('.trish-panel');
    const close = widget.querySelector('.trish-close');
    function openPanel() {
      panel.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
      if (!log.dataset.greeted) {
        addMessage('trish', randomGreeting(), { highlight: true });
        log.dataset.greeted = 'true';
      }
      input.focus();
    }
    function closePanel() {
      panel.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
    }
    toggle.addEventListener('click', () => {
      if (panel.hidden) openPanel(); else closePanel();
    });
    close.addEventListener('click', closePanel);

    widget.querySelector('.trish-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const message = input.value.trim();
      if (!message) return;
      input.value = '';
      await handleMessage(message);
    });
  }

  window.addEventListener('DOMContentLoaded', () => {
    createWidget();
  });
})();
