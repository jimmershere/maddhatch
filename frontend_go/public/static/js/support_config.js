window.MADDH_SUPPORT = Object.assign({
  email: 'support@maddhatchery.example',
  sms: '+15551234567',
  phone: '+1 (555) 123-4567',
  escalationHours: '08:00–20:00 CT',
  triage: {
    greetings: [
      'Hi there! Trish here — ready to help with hatchery hiccups.',
      'Howdy! Trish can wrangle any ordering snags you have.',
      'Hey friend! Let’s get you back to jamming and hatching in no time.'
    ],
    ticketPrefix: 'MHT-',
    severityHelp: 'Severity 1 = outage, 4 = informational. Trish logs every ticket with your summary so operations can respond fast.'
  }
}, window.MADDH_SUPPORT || {});

window.MADDH_OAUTH2_START = window.MADDH_OAUTH2_START || '/oauth2/start';
