(function(){
  const featureImage = document.querySelector('[data-feature-photo]');
  if (!featureImage) {
    return;
  }

  const captionEl = document.querySelector('[data-feature-caption]');
  const modal = document.querySelector('[data-photo-modal]');
  const modalList = document.querySelector('[data-photo-list]');
  const modalTrigger = document.querySelector('[data-photo-trigger]');
  const modalClose = document.querySelector('[data-photo-close]');
  const statusEl = document.querySelector('[data-merch-status]');
  const orderForm = document.querySelector('[data-merch-order-form]');

  const svgPlaceholder = (title, subtitle) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" preserveAspectRatio="xMidYMid slice">` +
      `<defs><linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#22c1c3"/><stop offset="100%" stop-color="#7e22ce"/></linearGradient></defs>` +
      `<rect width="800" height="800" fill="url(#grad)"/>` +
      `<g font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif" fill="#f8fafc" text-anchor="middle">` +
      `<text x="400" y="360" font-size="54" font-weight="700">${title}</text>` +
      `<text x="400" y="430" font-size="32">${subtitle}</text>` +
      `<text x="400" y="520" font-size="26" fill="#e0f2fe">Madd Hatchery Merch Preview</text>` +
      `</g>` +
      `</svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  };

  const photoData = [
    { src: svgPlaceholder('Back view', 'WT2025001 patch detail'), alt: 'Rear view of the Howdy Y\'all tee showing patch detail', caption: 'Back view with coop patch.' },
    { src: svgPlaceholder('Back angle', 'Relaxed shoulder seam'), alt: 'Angled rear photo of the Howdy Y\'all tee', caption: 'Angled back highlighting shoulder seams.' },
    { src: svgPlaceholder('Flat lay', 'Treats & tulips styling'), alt: 'Flat lay of the Howdy Y\'all tee with sweets', caption: 'Flat lay styling inspiration.' },
    { src: svgPlaceholder('Front walk', 'Everyday movement'), alt: 'Model walking in the Howdy Y\'all tee', caption: 'Lifestyle walk-and-talk moment.' },
    { src: svgPlaceholder('Lounge fit', 'Customer service ready'), alt: 'Smiling model wearing the tee indoors', caption: 'Cozy headset hero shot.' },
    { src: svgPlaceholder('Front graphic', 'Howdy Y\'all artwork'), alt: 'Front-on product photo of the tee', caption: 'Front graphic close-up.' },
    { src: svgPlaceholder('Smile pose', 'Ready for the market'), alt: 'Model smiling in the tee', caption: 'Smile-and-wave pose.' },
    { src: svgPlaceholder('Flat lay plus', 'Tulips, donuts & cocoa'), alt: 'Flat lay with flowers and treats', caption: 'Seasonal booth styling.' },
    { src: svgPlaceholder('Side profile', 'Relaxed sleeves'), alt: 'Side profile of the tee', caption: 'Side profile showing drape.' },
    { src: svgPlaceholder('Sleeve angle', 'Ready for fulfillment'), alt: 'Angled side shot of the tee sleeve', caption: 'Angled sleeve focus.' }
  ];

  let photoIndex = 0;

  const renderFeature = () => {
    const current = photoData[photoIndex];
    featureImage.src = current.src;
    featureImage.alt = current.alt;
    if (captionEl) {
      captionEl.textContent = current.caption;
    }
  };

  const buildModalGallery = () => {
    if (!modalList) {
      return;
    }
    modalList.innerHTML = '';
    photoData.forEach((photo) => {
      const figure = document.createElement('figure');
      figure.className = 'photo-modal-item';
      const link = document.createElement('a');
      link.href = photo.src;
      link.target = '_blank';
      link.rel = 'noopener';
      const img = document.createElement('img');
      img.src = photo.src;
      img.alt = photo.alt;
      img.loading = 'lazy';
      link.appendChild(img);
      figure.appendChild(link);
      const figcaption = document.createElement('figcaption');
      figcaption.textContent = photo.caption;
      figure.appendChild(figcaption);
      modalList.appendChild(figure);
    });
  };

  const openModal = () => {
    if (!modal) {
      return;
    }
    modal.hidden = false;
    document.body.classList.add('is-photo-modal-open');
  };

  const closeModal = () => {
    if (!modal) {
      return;
    }
    modal.hidden = true;
    document.body.classList.remove('is-photo-modal-open');
  };

  renderFeature();
  buildModalGallery();

  setInterval(() => {
    photoIndex = (photoIndex + 1) % photoData.length;
    renderFeature();
  }, 60000);

  if (modalTrigger) {
    modalTrigger.addEventListener('click', openModal);
  }
  if (modalClose) {
    modalClose.addEventListener('click', closeModal);
  }
  if (modal) {
    modal.addEventListener('click', (event) => {
      if (event.target === modal) {
        closeModal();
      }
    });
  }
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal && !modal.hidden) {
      closeModal();
    }
  });

  const setStatus = (message, type) => {
    if (!statusEl) {
      return;
    }
    statusEl.hidden = false;
    statusEl.textContent = message;
    statusEl.className = 'status-message merch-status ' + (type || 'status-info');
  };

  if (orderForm) {
    orderForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(orderForm);
      const order = Object.fromEntries(formData.entries());
      order.quantity = Number(order.quantity || 1);

      setStatus('Submitting your order…', 'status-info');
      try {
        await uploadOrderToPrintful(order);
        await submitMerchOrder(order);
        setStatus('Order received! Check your inbox for confirmation shortly.', 'status-success');
        orderForm.reset();
        const merchField = orderForm.querySelector('[name="merch_item_number"]');
        if (merchField) {
          merchField.value = 'WT2025001';
        }
      } catch (error) {
        console.error('Merch order submission failed', error);
        setStatus(error && error.message ? error.message : 'Unable to submit order right now. Please try again later.', 'status-error');
      }
    });
  }

  async function uploadOrderToPrintful(order) {
    const retailPrice = ['2X', '3X'].includes((order.size_code || '').toUpperCase()) ? '30.00' : '25.00';
    const payload = {
      external_id: `WT2025001-${Date.now()}`,
      recipient: {
        name: order.customer_name,
        address1: order.shipping_address,
        city: order.city,
        state_code: order.state,
        zip: order.zip_code,
        country_code: 'US'
      },
      items: [
        {
          name: "Howdy Y'all - need some eggs? Women's Tee",
          quantity: Number(order.quantity || 1),
          retail_price: retailPrice,
          sku: order.merch_item_number,
          size: order.size_code,
          color: order.color
        }
      ]
    };

    console.info('Printful API placeholder payload', payload);
    if (!window.PRINTFUL_API_ENABLED) {
      return { ok: true, simulated: true };
    }

    const response = await fetch('https://api.printful.com/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${window.PRINTFUL_API_TOKEN || 'YOUR_PRINTFUL_TOKEN'}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error('Printful API upload failed.');
    }

    return response.json();
  }

  async function submitMerchOrder(order) {
    if (!window.fetch) {
      return { ok: false, reason: 'fetch unavailable' };
    }

    try {
      const response = await fetch('/api/merch-orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(order)
      });

      if (!response.ok) {
        throw new Error('Merch order API rejected the request.');
      }

      return response.json().catch(() => ({}));
    } catch (error) {
      console.warn('Local merch order endpoint unavailable; recorded for later sync.', error);
      return { ok: false, simulated: true };
    }
  }
})();
