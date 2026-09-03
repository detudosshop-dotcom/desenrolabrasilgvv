/**
 * Universal Pixel Loader & Tracker
 * Real-time dynamic injector for UTMify, Facebook/Meta (Browser & CAPI) & TikTok
 */
(function() {
  window._pixelConfig = window._pixelConfig || { utmify: [], facebook: [], tiktok: [] };

  // 1. Initialize Facebook Pixel Base SDK
  function initFacebookSDK() {
    if (window.fbq) return;
    !function(f,b,e,v,n,t,s)
    {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};
    if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
    n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t,s)}(window, document,'script',
    'https://connect.facebook.net/en_US/fbevents.js');
  }

  // 2. Initialize TikTok Pixel Base SDK
  function initTikTokSDK() {
    if (window.ttq) return;
    !function (w, d, t) {
      w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=i,ttq._t=ttq._t||{},ttq._o=ttq._o||{},ttq._o[e]=n||{};var o=document.createElement("script");o.type="text/javascript",o.async=!0,o.src=i+"?sdkid="+e+"&lib="+t;var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};
    }(window, document, 'ttq');
  }

  // 3. Load from API and Execute
  async function loadPixels() {
    try {
      const res = await fetch('/api/pixels/public');
      if (res.ok) {
        const data = await res.json();
        if (data && data.pixels) {
          window._pixelConfig = data.pixels;
          applyPixels(data.pixels);
        }
      }
    } catch(err) {
      console.warn('Pixel loader fallback:', err.message);
    }
  }

  function applyPixels(pixels) {
    // A. Apply UTMify
    if (pixels.utmify && Array.isArray(pixels.utmify)) {
      pixels.utmify.forEach(utm => {
        if (utm.active !== false) {
          // If has script code, execute it
          if (utm.scriptCode) {
            try {
              let cleanCode = utm.scriptCode.replace(/<\/?script[^>]*>/gi, '').trim();
              if (cleanCode) {
                const s = document.createElement('script');
                s.type = 'text/javascript';
                s.text = cleanCode;
                (document.head || document.documentElement).appendChild(s);
              }
            } catch(e) {
              console.error('Error executing UTMify script code:', e);
            }
          }
          
          // If has token / pixelId
          if (utm.token) {
            window.pixelId = utm.token;
            const utmScript = document.createElement('script');
            utmScript.async = true;
            utmScript.defer = true;
            utmScript.src = 'https://cdn.utmify.com.br/scripts/pixel/pixel.js';
            (document.head || document.documentElement).appendChild(utmScript);

            const utmUtms = document.createElement('script');
            utmUtms.async = true;
            utmUtms.src = 'https://cdn.utmify.com.br/scripts/utms/latest.js';
            utmUtms.setAttribute('data-utmify-token', utm.token);
            (document.head || document.documentElement).appendChild(utmUtms);
          }
        }
      });
    }

    // B. Apply Facebook / Meta Pixels
    if (pixels.facebook && Array.isArray(pixels.facebook)) {
      initFacebookSDK();
      pixels.facebook.forEach(fb => {
        if (fb.active !== false && fb.pixelId) {
          try {
            fbq('init', fb.pixelId);
            fbq('track', 'PageView');
            if (fb.code && !fb.code.includes('fbq(\'init\',')) {
              eval(fb.code);
            }
          } catch(e) {
            console.error('Error initializing FB Pixel:', fb.pixelId, e);
          }
        }
      });
    }

    // C. Apply TikTok Pixels
    if (pixels.tiktok && Array.isArray(pixels.tiktok)) {
      initTikTokSDK();
      pixels.tiktok.forEach(tt => {
        if (tt.active !== false && tt.pixelId) {
          try {
            ttq.load(tt.pixelId);
            ttq.page();
            if (tt.code) eval(tt.code);
          } catch(e) {
            console.error('Error initializing TT Pixel:', tt.pixelId, e);
          }
        }
      });
    }
  }

  // 4. Global Event Dispatcher
  window.firePixelEvent = function(eventName, data) {
    data = data || {};

    // Facebook
    if (window.fbq && window._pixelConfig.facebook) {
      window._pixelConfig.facebook.forEach(fb => {
        if (fb.active !== false && fb.pixelId) {
          try {
            fbq('trackSingle', fb.pixelId, eventName, data);
          } catch(e) {}
        }
      });
    }

    // TikTok
    if (window.ttq && window._pixelConfig.tiktok) {
      window._pixelConfig.tiktok.forEach(tt => {
        if (tt.active !== false && tt.pixelId) {
          try {
            ttq.instance(tt.pixelId).track(eventName, data);
          } catch(e) {}
        }
      });
    }

    console.log('[Pixel Event Fired]:', eventName, data);
  };

  // Start on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadPixels);
  } else {
    loadPixels();
  }
})();
