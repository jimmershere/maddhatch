(function () {
  const galleries = document.querySelectorAll('[data-rotating-gallery]');
  if (!galleries.length) {
    return;
  }

  const isAbsolute = (value) => /^(?:https?:)?\/\//.test(value) || value.startsWith('/');

  const normaliseEntries = (rawEntries, basePath) => {
    if (!rawEntries) {
      return [];
    }

    let entries = rawEntries;
    if (typeof entries === 'string') {
      try {
        entries = JSON.parse(entries);
      } catch (error) {
        console.warn('Gallery images attribute is not valid JSON:', error);
        entries = [];
      }
    }

    if (Array.isArray(entries)) {
      return entries
        .map((item) => {
          if (typeof item === 'string') {
            const src = item.trim();
            const resolvedSrc = !src ? '' : isAbsolute(src) ? src : `${basePath.replace(/\/$/, '')}/${src}`;
            return resolvedSrc ? { src: resolvedSrc } : null;
          }

          if (item && typeof item === 'object') {
            const candidate = item.src || item.url || item.path || '';
            const resolvedSrc = !candidate
              ? ''
              : isAbsolute(candidate)
              ? candidate
              : `${basePath.replace(/\/$/, '')}/${candidate}`;
            if (!resolvedSrc) {
              return null;
            }

            return {
              src: resolvedSrc,
              alt: item.alt || item.caption || item.title || '',
              caption: item.caption || item.alt || item.title || '',
            };
          }

          return null;
        })
        .filter(Boolean);
    }

    if (entries && typeof entries === 'object' && Array.isArray(entries.images)) {
      return normaliseEntries(entries.images, basePath);
    }

    return [];
  };

  const fetchEntries = async (gallery) => {
    const basePath = gallery.dataset.galleryPath || '';
    const manualEntries = normaliseEntries(gallery.dataset.galleryImages, basePath);

    if (manualEntries.length) {
      return manualEntries;
    }

    if (!basePath) {
      return [];
    }

    try {
      const response = await fetch(`${basePath.replace(/\/$/, '')}/gallery.json`, { cache: 'no-store' });
      if (!response.ok) {
        return [];
      }

      const payload = await response.json();
      return normaliseEntries(payload, basePath);
    } catch (error) {
      console.warn('Unable to load gallery manifest from', basePath, error);
      return [];
    }
  };

  const initialiseGallery = async (gallery) => {
    const interval = Number.parseInt(gallery.dataset.galleryInterval, 10) || 10000;
    const altFallback = gallery.dataset.galleryAlt || 'Gallery image';
    const captionFallback = gallery.dataset.galleryCaption || '';
    const emptyMessage = gallery.dataset.galleryEmpty || gallery.querySelector('[data-gallery-placeholder]')?.textContent?.trim() || 'Gallery images coming soon.';

    const stage = gallery.querySelector('[data-gallery-stage]');
    const placeholder = gallery.querySelector('[data-gallery-placeholder]');
    const captionEl = gallery.querySelector('[data-gallery-caption]');

    if (!stage) {
      return;
    }

    const entries = await fetchEntries(gallery);
    if (!entries.length) {
      if (placeholder) {
        placeholder.textContent = emptyMessage;
        placeholder.hidden = false;
      }
      stage.setAttribute('data-gallery-empty', 'true');
      if (captionEl) {
        captionEl.hidden = true;
      }
      return;
    }

    let currentIndex = 0;
    let imgEl = stage.querySelector('img');

    if (!imgEl) {
      imgEl = document.createElement('img');
      imgEl.decoding = 'async';
      imgEl.loading = 'lazy';
      imgEl.className = 'gallery-image';
      stage.appendChild(imgEl);
    }

    const showEntry = (entry) => {
      const altText = entry.alt || altFallback;
      const captionText = entry.caption || entry.alt || captionFallback;

      if (placeholder) {
        placeholder.hidden = true;
      }
      stage.removeAttribute('data-gallery-empty');

      imgEl.src = entry.src;
      imgEl.alt = altText;

      if (captionEl) {
        if (captionText) {
          captionEl.textContent = captionText;
          captionEl.hidden = false;
        } else {
          captionEl.textContent = '';
          captionEl.hidden = true;
        }
      }
    };

    showEntry(entries[currentIndex]);

    if (entries.length > 1) {
      setInterval(() => {
        currentIndex = (currentIndex + 1) % entries.length;
        showEntry(entries[currentIndex]);
      }, interval);
    }
  };

  galleries.forEach((gallery) => {
    initialiseGallery(gallery);
  });
})();
