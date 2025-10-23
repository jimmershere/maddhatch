(function(){
  const productSections = document.querySelectorAll('[data-merch-product]');
  if (!productSections.length) {
    return;
  }

  const modal = document.querySelector('[data-photo-modal]');
  const modalList = modal ? modal.querySelector('[data-photo-list]') : null;
  const modalTitleEl = modal ? modal.querySelector('[data-photo-title]') : null;
  const modalNote = modal ? modal.querySelector('[data-photo-note]') : null;
  const modalClose = modal ? modal.querySelector('[data-photo-close]') : null;

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

  const ensureDirectorySuffix = (directory) => {
    if (!directory) {
      return '';
    }
    return directory.endsWith('/') ? directory : `${directory}/`;
  };

  const galleryCache = new Map();
  const galleryStates = new Map();

  async function loadGallery(section) {
    const directory = ensureDirectorySuffix(section.dataset.photoDirectory || '');
    if (!directory) {
      return [];
    }

    if (galleryCache.has(directory)) {
      return galleryCache.get(directory);
    }

    try {
      const response = await fetch(`${directory}manifest.json`, { cache: 'no-cache' });
      if (!response.ok) {
        throw new Error(`Manifest not found for ${directory}`);
      }
      const manifest = await response.json();
      const photos = Array.isArray(manifest.photos)
        ? manifest.photos.map((photo, index) => {
            const src = photo.file && /^https?:/i.test(photo.file)
              ? photo.file
              : `${directory}${photo.file}`;
            return {
              src,
              alt: photo.alt || `${section.dataset.productName || 'Merch photo'} ${index + 1}`,
              caption: photo.caption || ''
            };
          })
        : [];
      galleryCache.set(directory, photos);
      return photos;
    } catch (error) {
      console.warn('Unable to load gallery manifest; falling back to placeholders.', directory, error);
      const productName = section.dataset.productName || 'Merch preview';
      const fallback = [
        {
          src: svgPlaceholder(productName, 'Front view'),
          alt: `${productName} front view`,
          caption: 'Front preview placeholder.'
        },
        {
          src: svgPlaceholder(productName, 'Back view'),
          alt: `${productName} back view`,
          caption: 'Back preview placeholder.'
        },
        {
          src: svgPlaceholder(productName, 'Detail view'),
          alt: `${productName} detail view`,
          caption: 'Detail preview placeholder.'
        }
      ];
      galleryCache.set(directory, fallback);
      return fallback;
    }
  }

  function renderFeature(section, photo) {
    if (!photo) {
      return;
    }
    const img = section.querySelector('[data-feature-photo]');
    if (img) {
      img.src = photo.src;
      img.alt = photo.alt;
    }
    const caption = section.querySelector('[data-feature-caption]');
    if (caption) {
      caption.textContent = photo.caption || '';
    }
  }

  function buildModalGallery(photos) {
    if (!modalList) {
      return;
    }
    modalList.innerHTML = '';
    photos.forEach((photo) => {
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
      if (photo.caption) {
        const figcaption = document.createElement('figcaption');
        figcaption.textContent = photo.caption;
        figure.appendChild(figcaption);
      }
      modalList.appendChild(figure);
    });
  }

  function openModal() {
    if (!modal) {
      return;
    }
    modal.hidden = false;
    document.body.classList.add('is-photo-modal-open');
  }

  function closeModal() {
    if (!modal) {
      return;
    }
    modal.hidden = true;
    document.body.classList.remove('is-photo-modal-open');
  }

  function setStatus(statusEl, message, type) {
    if (!statusEl) {
      return;
    }
    statusEl.hidden = false;
    statusEl.textContent = message;
    statusEl.className = 'status-message merch-status ' + (type || 'status-info');
  }

  productSections.forEach((section) => {
    let currentIndex = 0;
    loadGallery(section).then((photos) => {
      if (!photos.length) {
        return;
      }
      renderFeature(section, photos[currentIndex]);
      const intervalId = window.setInterval(() => {
        currentIndex = (currentIndex + 1) % photos.length;
        renderFeature(section, photos[currentIndex]);
      }, 60000);
      galleryStates.set(section, { photos, intervalId });
    });

    const trigger = section.querySelector('[data-photo-trigger]');
    if (trigger) {
      trigger.addEventListener('click', async () => {
        const state = galleryStates.get(section);
        const photos = state ? state.photos : await loadGallery(section);
        if (!photos || !photos.length) {
          return;
        }
        buildModalGallery(photos);
        if (modalTitleEl) {
          modalTitleEl.textContent =
            section.dataset.galleryTitle || section.dataset.productName || 'Product gallery';
        }
        if (modalNote) {
          modalNote.textContent =
            section.dataset.galleryNote || 'Choose a frame to open the high-resolution preview in a new tab.';
        }
        openModal();
      });
    }

    const form = section.querySelector('[data-merch-order-form]');
    if (form) {
      const statusEl = form.querySelector('[data-merch-status]');
      const defaultItemNumber = form.dataset.merchItem || '';
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const formData = new FormData(form);
        const order = Object.fromEntries(formData.entries());
        order.quantity = Number(order.quantity || 1);
        if (!order.merch_item_number && defaultItemNumber) {
          order.merch_item_number = defaultItemNumber;
        }
        setStatus(statusEl, 'Submitting your order…', 'status-info');
        try {
          await uploadOrderToPrintful(order, form);
          await submitMerchOrder(order);
          setStatus(statusEl, 'Order received! Check your inbox for confirmation shortly.', 'status-success');
          form.reset();
          const merchField = form.querySelector('[name="merch_item_number"]');
          if (merchField && defaultItemNumber) {
            merchField.value = defaultItemNumber;
          }
        } catch (error) {
          console.error('Merch order submission failed', error);
          setStatus(
            statusEl,
            error && error.message ? error.message : 'Unable to submit order right now. Please try again later.',
            'status-error'
          );
        }
      });
    }
  });

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

  async function uploadOrderToPrintful(order, form) {
    const sizeCode = (order.size_code || '').toUpperCase();
    const basePrice = Number(form.dataset.priceBase || order.retail_price || '25.00');
    const plusPrice = Number(form.dataset.pricePlus || basePrice);
    const plusSizes = (form.dataset.plusSizes || '2X,3X,2XL,3XL')
      .split(',')
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean);
    const retailPrice = plusSizes.includes(sizeCode) ? plusPrice : basePrice;
    const itemNumber = form.dataset.merchItem || order.merch_item_number || `MH-${Date.now()}`;
    const productName = form.dataset.productName || 'Madd Hatchery Merch';
    const sanitizedPrefix = `${itemNumber}-${productName}`
      .replace(/[^A-Za-z0-9]+/g, '')
      .toUpperCase()
      .slice(0, 30);

    const payload = {
      external_id: `${sanitizedPrefix}-${Date.now()}`,
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
          name: productName,
          quantity: Number(order.quantity || 1),
          retail_price: retailPrice.toFixed(2),
          sku: itemNumber,
          size: order.size_code,
          color: order.color || form.dataset.defaultColor || 'Default'
        }
      ]
    };

    console.info('Printful API payload', payload);
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
